import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, mondayMappings, users } from "@/db/schema";
import { monday, type MondayItem } from "@/server/integrations/monday";
import { runJob } from "./runner";

/* VAKANTIES PLANNEN — verlof/vakantie per teamlid. */
const LEAVE_BOARD = "5096228676";
const C = {
  medewerker: "multiple_person_mm38mt2n",
  vanDatum: "date_mm38ad01",
  totDatum: "date_mm38mkxt",
  aantalDagen: "numeric_mm381jrv",
  statusAanvraag: "color_mm38eayg",
  typeVerlof: "dropdown_mm38h2pd",
};

function col(item: MondayItem, id: string): string {
  return (item.column_values.find((c) => c.id === id)?.text ?? "").trim();
}
function firstPerson(item: MondayItem, id: string): string | null {
  const t = col(item, id);
  return t ? t.split(",")[0]!.trim() : null;
}

/** "In afwachting" → requested, "Goedgekeurd" → approved, "Afgewezen" → rejected. */
function mapStatus(label: string): "requested" | "approved" | "rejected" {
  const s = label.toLowerCase();
  if (s.includes("goedgekeurd")) return "approved";
  if (s.includes("afgewezen") || s.includes("geweigerd")) return "rejected";
  return "requested";
}

/** Dropdown-label naar het soort verlof (vrije tekst, zoals de app die toont). */
function mapKind(label: string): string {
  const s = label.toLowerCase().trim();
  if (!s) return "vakantie";
  if (s.startsWith("vakantie")) return "vakantie";
  if (s.startsWith("ziek")) return "ziek";
  if (s.startsWith("vrije")) return "vrije dag";
  if (s.startsWith("bijzonder")) return "bijzonder verlof";
  if (s.startsWith("compensatie")) return "compensatie uren";
  return s.slice(0, 32);
}

/**
 * Bestaande gebruiker zoeken op naam (eerst via het vaste e-mailpatroon
 * voornaam@shortclips.nl, anders op volledige naam). We maken hier géén nieuwe
 * gebruikers aan — verlof hoort bij een bekend teamlid.
 */
async function matchUserId(name: string | null): Promise<string | null> {
  const clean = (name ?? "").trim();
  if (!clean) return null;
  const first = clean.split(/\s+/)[0]!.toLowerCase();
  const email = `${first}@shortclips.nl`;
  const [hit] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        or(eq(users.email, email), sql`lower(${users.fullName}) = ${clean.toLowerCase()}`),
      ),
    )
    .limit(1);
  return hit?.id ?? null;
}

export async function runMondayLeaveImport() {
  return runJob("monday", "monday.import_leave", {}, async (ctx) => {
    const items = await monday.listItems(LEAVE_BOARD, 500);
    ctx.log(`${items.length} verlofaanvragen op het bord`);

    const userCache = new Map<string, string | null>();
    async function user(name: string | null): Promise<string | null> {
      if (!name) return null;
      if (!userCache.has(name)) userCache.set(name, await matchUserId(name));
      return userCache.get(name)!;
    }

    for (const item of items) {
      const startOn = col(item, C.vanDatum).slice(0, 10);
      const endOnRaw = col(item, C.totDatum).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn)) continue; // zonder begindatum geen aanvraag
      const endOn = /^\d{4}-\d{2}-\d{2}$/.test(endOnRaw) ? endOnRaw : startOn;

      // Teamlid: eerst de people-kolom, anders de groepnaam (Rutger/Milou/Jiska).
      const userId = (await user(firstPerson(item, C.medewerker))) ?? (await user(item.group?.title ?? null));
      if (!userId) {
        ctx.counters.failed++;
        continue;
      }
      ctx.counters.processed++;

      const dagen = col(item, C.aantalDagen);
      const base = {
        userId,
        startOn,
        endOn,
        kind: mapKind(col(item, C.typeVerlof)),
        status: mapStatus(col(item, C.statusAanvraag)),
        note: dagen ? `${dagen} werkdag(en) · geïmporteerd uit Monday` : "Geïmporteerd uit Monday",
        updatedAt: new Date(),
      };

      const [map] = await db
        .select({ id: mondayMappings.id, entityId: mondayMappings.entityId })
        .from(mondayMappings)
        .where(and(eq(mondayMappings.entityType, "leave_request"), eq(mondayMappings.itemId, item.id)))
        .limit(1);

      if (map?.entityId) {
        await db.update(leaveRequests).set(base).where(eq(leaveRequests.id, map.entityId));
        await db.update(mondayMappings).set({ lastSyncedAt: new Date() }).where(eq(mondayMappings.id, map.id));
        ctx.counters.updated++;
      } else {
        const [created] = await db.insert(leaveRequests).values(base).returning({ id: leaveRequests.id });
        await db.insert(mondayMappings).values({
          entityType: "leave_request",
          entityId: created!.id,
          boardId: LEAVE_BOARD,
          itemId: item.id,
          lastSyncedAt: new Date(),
        });
        ctx.counters.created++;
      }
    }
    ctx.log(`Klaar: ${ctx.counters.created} nieuw, ${ctx.counters.updated} bijgewerkt, ${ctx.counters.failed} zonder match.`);
  });
}
