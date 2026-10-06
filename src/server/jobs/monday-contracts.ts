import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contracts, mondayMappings } from "@/db/schema";
import { monday, type MondayItem } from "@/server/integrations/monday";
import { normalizeName, matchScore } from "@/server/import";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import { runJob } from "./runner";

/* CONTRACT DUUR — contract/afspraak per klant. */
const CONTRACT_BOARD = "5099820753";
const C = {
  samenwerking: "color_mm51kp21", // Contract bepaalde/onbepaalde tijd, mondeling, los project, 3 maanden
  einddatum: "date_mm51jgsv",
  status: "color_mm515eef", // Actief / verloopt binnenkort / verlopen / doorlopend / beëindigd
  verleng: "color_mm7fbzq6",
};

function col(item: MondayItem, id: string): string {
  return (item.column_values.find((c) => c.id === id)?.text ?? "").trim();
}

function mapStatus(s: string): "active" | "expired" | "terminated" {
  const t = s.toLowerCase();
  if (t.includes("verlopen")) return "expired";
  if (t.includes("beëindigd") || t.includes("beeindigd")) return "terminated";
  if (t.includes("afgerond")) return "expired";
  return "active"; // Actief, verloopt binnenkort, doorlopende samenwerking
}

/** Doorlopende/onbepaalde vormen verlengen automatisch; bepaalde tijd niet. */
function mapAutoRenew(samenwerking: string): boolean {
  const t = samenwerking.toLowerCase();
  if (t.includes("onbepaalde") || t.includes("doorlopend")) return true;
  return false;
}

export async function runMondayContractImport() {
  return runJob("monday", "monday.import_contracts", {}, async (ctx) => {
    const clientRows = await db
      .select({
        id: clients.id,
        name: clients.name,
        slug: clients.slug,
        startedOn: clients.startedOn,
        monthlyRevenue: clients.monthlyRevenue,
      })
      .from(clients)
      .where(isNull(clients.deletedAt));
    function matchClient(name: string) {
      const n = normalizeName(name);
      if (!n) return null;
      const hits = clientRows.filter((c) => {
        if (normalizeName(c.name) === n || normalizeName(c.slug) === n) return true;
        if (aliasesForSlug(c.slug).some((a) => normalizeName(a) === n)) return true;
        return matchScore(name, c.name) >= 90;
      });
      return hits.length === 1 ? hits[0]! : null;
    }

    const today = new Date().toISOString().slice(0, 10);
    const items = await monday.listItems(CONTRACT_BOARD, 200);
    ctx.log(`${items.length} contract-items`);

    for (const item of items) {
      const client = matchClient(item.name);
      if (!client) {
        ctx.counters.failed++;
        continue;
      }
      ctx.counters.processed++;

      const samenwerking = col(item, C.samenwerking);
      const endText = col(item, C.einddatum);
      const endsOn = /^\d{4}-\d{2}-\d{2}/.test(endText) ? endText.slice(0, 10) : null;
      const renewalMonths = /3\s*maand/i.test(samenwerking) ? 3 : 12;

      const base = {
        clientId: client.id,
        status: mapStatus(col(item, C.status)),
        startsOn: client.startedOn ?? today,
        endsOn,
        autoRenew: mapAutoRenew(samenwerking),
        renewalMonths,
        monthlyValue: client.monthlyRevenue ?? "0",
        reference: samenwerking || null,
        updatedAt: new Date(),
      };

      const [map] = await db
        .select({ id: mondayMappings.id, entityId: mondayMappings.entityId })
        .from(mondayMappings)
        .where(and(eq(mondayMappings.entityType, "contract"), eq(mondayMappings.itemId, item.id)))
        .limit(1);

      if (map?.entityId) {
        await db.update(contracts).set(base).where(eq(contracts.id, map.entityId));
        await db.update(mondayMappings).set({ lastSyncedAt: new Date() }).where(eq(mondayMappings.id, map.id));
        ctx.counters.updated++;
      } else {
        const [created] = await db.insert(contracts).values(base).returning({ id: contracts.id });
        await db.insert(mondayMappings).values({
          entityType: "contract",
          entityId: created!.id,
          boardId: CONTRACT_BOARD,
          itemId: item.id,
          lastSyncedAt: new Date(),
        });
        ctx.counters.created++;
      }
    }
    ctx.log(`Klaar: ${ctx.counters.created} nieuw, ${ctx.counters.updated} bijgewerkt.`);
  });
}
