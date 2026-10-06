import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, mondayMappings, productionDays, users } from "@/db/schema";
import { monday, type MondayItem } from "@/server/integrations/monday";
import { normalizeName, matchScore } from "@/server/import";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import { runJob } from "./runner";

/* PROJECT PLANNING — opnameprojecten per klant. */
const PLANNING_BOARD = "5095905069";
const TEMPLATE_GROUPS = new Set(["group_mm33ecf3", "group_mm3399q7"]);
const C = {
  opnamedatum: "date_mkxer36a",
  fase: "color_mm5pfn5t",
  videograaf: "multiple_person_mkx1hnq",
  locatie: "location_mm5sfjja",
  starttijd: "hour_mm5s4tgj",
  bevestigd: "boolean_mm5sfrmz",
  verantwoordelijke: "multiple_person_mm6px2jv",
  contact: "text_mm5s7wad",
};

function col(item: MondayItem, id: string): string {
  return (item.column_values.find((c) => c.id === id)?.text ?? "").trim();
}
function rawVal(item: MondayItem, id: string): string | null {
  return item.column_values.find((c) => c.id === id)?.value ?? null;
}
/** Eerste persoonsnaam uit een people-kolom (tekst "A, B" → "A"). */
function firstPerson(item: MondayItem, id: string): string | null {
  const t = col(item, id);
  return t ? t.split(",")[0]!.trim() : null;
}
/** Starttijd "HH:MM:SS" uit een hour-kolom. */
function startTime(item: MondayItem): string | null {
  const raw = rawVal(item, C.starttijd);
  if (raw) {
    try {
      const v = JSON.parse(raw) as { hour?: number; minute?: number };
      if (typeof v.hour === "number") {
        const hh = String(v.hour).padStart(2, "0");
        const mm = String(v.minute ?? 0).padStart(2, "0");
        return `${hh}:${mm}:00`;
      }
    } catch {
      /* val terug op tekst */
    }
  }
  const t = col(item, C.starttijd); // "09:00"
  const m = t.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}:00` : null;
}

function mapStatus(
  fase: string,
  bevestigd: boolean,
): "planned" | "confirmed" | "in_progress" | "completed" {
  const f = fase.toLowerCase();
  if (["afgerond", "publicatie en afronding", "feedback en finalisatie", "editing"].includes(f)) {
    return "completed";
  }
  if (f === "opname") return "in_progress";
  return bevestigd ? "confirmed" : "planned";
}

/** Zorgt dat een teamlid als gebruiker bestaat; corrigeert ook de naam. */
async function ensureUser(
  name: string,
  role: "videographer" | "project_coordinator",
): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const first = clean.split(/\s+/)[0]!.toLowerCase();
  const email = `${first}@shortclips.nl`;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    await db.update(users).set({ fullName: clean, updatedAt: new Date() }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [created] = await db
    .insert(users)
    .values({ email, fullName: clean, primaryRole: role, status: "active" })
    .returning({ id: users.id });
  return created!.id;
}

export async function runMondayPlanningImport() {
  return runJob("monday", "monday.import_planning", {}, async (ctx) => {
    const clientRows = await db
      .select({ id: clients.id, name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId })
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

    const userCache = new Map<string, string | null>();
    async function user(name: string | null, role: "videographer" | "project_coordinator") {
      if (!name) return null;
      const key = `${role}:${name}`;
      if (!userCache.has(key)) userCache.set(key, await ensureUser(name, role));
      return userCache.get(key)!;
    }

    const items = await monday.listItems(PLANNING_BOARD, 300);
    ctx.log(`${items.length} opnameprojecten op het bord`);

    for (const item of items) {
      if (item.group && TEMPLATE_GROUPS.has(item.group.id)) continue;
      const dateText = col(item, C.opnamedatum);
      if (!/^\d{4}-\d{2}-\d{2}/.test(dateText)) continue; // geen opnamedatum → geen opnamedag
      const client = matchClient(item.name);
      if (!client) {
        ctx.counters.failed++;
        continue;
      }
      ctx.counters.processed++;

      const scheduledOn = dateText.slice(0, 10);
      const bevestigd = /^v$|true|ja|waar/i.test(col(item, C.bevestigd)) || rawVal(item, C.bevestigd)?.includes("true") === true;
      const videographerId = await user(firstPerson(item, C.videograaf), "videographer");
      const coordinatorId = await user(firstPerson(item, C.verantwoordelijke), "project_coordinator");

      const base = {
        clientId: client.id,
        title: `Opnamedag ${client.name}`,
        scheduledOn,
        ...(startTime(item) ? { startTime: startTime(item)! } : {}),
        ...(col(item, C.locatie) ? { locationName: col(item, C.locatie).slice(0, 200) } : {}),
        status: mapStatus(col(item, C.fase), bevestigd),
        ...(videographerId ? { videographerId } : {}),
        ...(coordinatorId ? { coordinatorId } : {}),
        ...(col(item, C.contact) ? { schedule: `Contact op locatie: ${col(item, C.contact)}` } : {}),
        updatedAt: new Date(),
      };

      // De klant z'n vaste coördinator overnemen als die er nog niet is (§16).
      if (coordinatorId && !client.coordinatorId) {
        await db.update(clients).set({ coordinatorId, updatedAt: new Date() }).where(eq(clients.id, client.id));
        client.coordinatorId = coordinatorId;
      }

      const [map] = await db
        .select({ id: mondayMappings.id, entityId: mondayMappings.entityId })
        .from(mondayMappings)
        .where(and(eq(mondayMappings.entityType, "production_day"), eq(mondayMappings.itemId, item.id)))
        .limit(1);

      if (map?.entityId) {
        await db.update(productionDays).set(base).where(eq(productionDays.id, map.entityId));
        await db.update(mondayMappings).set({ lastSyncedAt: new Date() }).where(eq(mondayMappings.id, map.id));
        ctx.counters.updated++;
      } else {
        const [created] = await db.insert(productionDays).values(base).returning({ id: productionDays.id });
        await db.insert(mondayMappings).values({
          entityType: "production_day",
          entityId: created!.id,
          boardId: PLANNING_BOARD,
          itemId: item.id,
          lastSyncedAt: new Date(),
        });
        ctx.counters.created++;
      }
    }
    ctx.log(`Klaar: ${ctx.counters.created} nieuw, ${ctx.counters.updated} bijgewerkt.`);
  });
}
