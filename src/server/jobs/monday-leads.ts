import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { mondayMappings, salesLeads, users } from "@/db/schema";
import { monday, type MondayItem } from "@/server/integrations/monday";
import { runJob } from "./runner";

/* LEADS 2026 DASHBOARD — alle leads/offertes van Shortclips. */
const LEADS_BOARD = "5099852338";
const C = {
  bron: "color_mkx4hf3f",
  status: "color_mkx1v957",
  eersteContact: "date_mkx1jb37",
  naamKlant: "text_mkx1pmw5",
  leadInfo: "text_mkx16dj8",
  telefoon: "phone_mkx129jf",
  email: "email_mkx1zbje",
  budget: "text_mkx2j5ck",
  dealCloser: "multiple_person_mkxnjks6",
  opvolgen: "date_mm7a1c0m",
  auditUitkomst: "text_mm7p652j",
  leadklasse: "text_mm7pe8z2",
  leadscore: "numeric_mm7pk907",
  vervolgstap: "text_mm7pc32d",
  website: "text_mm7p5j8m",
  salesbrief: "long_text_mm7pptr1",
};

function col(item: MondayItem, id: string): string {
  return (item.column_values.find((c) => c.id === id)?.text ?? "").trim();
}
function firstPerson(item: MondayItem, id: string): string | null {
  const t = col(item, id);
  return t ? t.split(",")[0]!.trim() : null;
}
function dateOrNull(item: MondayItem, id: string): string | null {
  const t = col(item, id).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}
function intOrNull(item: MondayItem, id: string): number | null {
  const t = col(item, id).replace(",", ".");
  if (!t) return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) ? n : null;
}
function trimTo(s: string, max: number): string | null {
  const v = s.trim();
  return v ? v.slice(0, max) : null;
}

/** Monday-status → onze bucket (lead/offerte/onderhandeling/gewonnen/verloren). */
function mapStatus(label: string): string {
  const s = label.toLowerCase();
  if (s.includes("gewonnen")) return "gewonnen";
  if (["verloren", "lost", "niet gekwalificeerd", "niet interessant", "spam"].some((x) => s.includes(x)))
    return "verloren";
  if (s.includes("offerte")) return "offerte";
  if (s.includes("afspraak") || s.includes("opvolging") || s.includes("onderhandel")) return "onderhandeling";
  return "lead";
}

function segmentFromGroup(title: string | undefined): string | null {
  if (!title) return null;
  const m = title.match(/(20\d{2})/);
  return m ? m[1]! : trimTo(title, 24);
}

/** Bestaande gebruiker (deal closer) op e-mailpatroon of volledige naam; niet aanmaken. */
async function matchUserId(name: string | null): Promise<string | null> {
  const clean = (name ?? "").trim();
  if (!clean) return null;
  const first = clean.split(/\s+/)[0]!.toLowerCase();
  const [hit] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        or(eq(users.email, `${first}@shortclips.nl`), sql`lower(${users.fullName}) = ${clean.toLowerCase()}`),
      ),
    )
    .limit(1);
  return hit?.id ?? null;
}

export async function runMondayLeadsImport() {
  return runJob("monday", "monday.import_leads", {}, async (ctx) => {
    const items = await monday.listItems(LEADS_BOARD, 1000);
    ctx.log(`${items.length} leads op het bord`);

    const ownerCache = new Map<string, string | null>();
    async function owner(name: string | null): Promise<string | null> {
      if (!name) return null;
      if (!ownerCache.has(name)) ownerCache.set(name, await matchUserId(name));
      return ownerCache.get(name)!;
    }

    for (const item of items) {
      const naamKlant = col(item, C.naamKlant);
      const company = trimTo(naamKlant || item.name, 200);
      if (!company) continue;
      ctx.counters.processed++;

      const mondayStatus = col(item, C.status);
      const ownerId = await owner(firstPerson(item, C.dealCloser));
      // Item-naam als contactpersoon wanneer die afwijkt van de bedrijfsnaam.
      const contactName =
        naamKlant && item.name && item.name.trim().toLowerCase() !== naamKlant.toLowerCase()
          ? trimTo(item.name, 160)
          : null;

      // Monday-brondata: wordt bij elke sync ververst (contactgegevens, bron,
      // audit, en de ruwe Monday-status als spiegel).
      const monField = {
        company,
        contactName,
        mondayStatus: trimTo(mondayStatus, 60),
        source: trimTo(col(item, C.bron), 40),
        phone: trimTo(col(item, C.telefoon), 40),
        email: trimTo(col(item, C.email), 160),
        website: trimTo(col(item, C.website), 200),
        budget: trimTo(col(item, C.budget), 120),
        firstContactOn: dateOrNull(item, C.eersteContact),
        leadClass: trimTo(col(item, C.leadklasse), 8),
        leadScore: intOrNull(item, C.leadscore),
        auditOutcome: trimTo(col(item, C.auditUitkomst), 80),
        auditNextStep: trimTo(col(item, C.vervolgstap), 120),
        salesBrief: trimTo(col(item, C.salesbrief), 8000),
        segment: segmentFromGroup(item.group?.title),
        note: trimTo(col(item, C.leadInfo), 2000),
        ...(ownerId ? { ownerId } : {}),
        updatedAt: new Date(),
      };

      const [map] = await db
        .select({ id: mondayMappings.id, entityId: mondayMappings.entityId })
        .from(mondayMappings)
        .where(and(eq(mondayMappings.entityType, "sales_lead"), eq(mondayMappings.itemId, item.id)))
        .limit(1);

      if (map?.entityId) {
        // Alleen brondata verversen; status/opvolgdatum zijn na import app-eigen,
        // zodat handmatige wijzigingen in de app blijven staan.
        await db.update(salesLeads).set(monField).where(eq(salesLeads.id, map.entityId));
        await db.update(mondayMappings).set({ lastSyncedAt: new Date() }).where(eq(mondayMappings.id, map.id));
        ctx.counters.updated++;
      } else {
        const [created] = await db
          .insert(salesLeads)
          .values({ ...monField, status: mapStatus(mondayStatus), followUpOn: dateOrNull(item, C.opvolgen) })
          .returning({ id: salesLeads.id });
        await db.insert(mondayMappings).values({
          entityType: "sales_lead",
          entityId: created!.id,
          boardId: LEADS_BOARD,
          itemId: item.id,
          lastSyncedAt: new Date(),
        });
        ctx.counters.created++;
      }
    }
    ctx.log(`Klaar: ${ctx.counters.created} nieuw, ${ctx.counters.updated} bijgewerkt.`);
  });
}
