import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clientContacts, clientIntegrations, clients, users } from "@/db/schema";
import { monday, type MondayItem } from "@/server/integrations/monday";
import { normalizeName } from "@/server/import";
import { runJob } from "./runner";

/* Board- en kolom-id's uit de ShortClips Monday-omgeving. */
const HOOFDBOARD = "5095883798";
const CONTACTEN = "5102088079";

const H = {
  status: "color_mkx2a8g3",
  revenue: "numeric_mm0ae0q9",
  startDate: "date_mm0d59r5",
  platforms: "dropdown_mm7jszaj",
  agendaNames: "text_mm7qatwy",
  accountManager: "multiple_person_mm5sv241",
};
const C = {
  bedrijf: "text_mm651sdq",
  naam: "text_mm65zza2",
  email: "email_mm65pky4",
  phone: "phone_mm6546w",
  primary: "color_mm65m2rv",
  relation: "board_relation_mm6541p8",
};

function col(item: MondayItem, id: string): string {
  return (item.column_values.find((c) => c.id === id)?.text ?? "").trim();
}
function rawVal(item: MondayItem, id: string): string | null {
  return item.column_values.find((c) => c.id === id)?.value ?? null;
}
function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "klant";
}
function parseMoney(text: string): string | null {
  const n = Number(text.replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}
/** Linked HOOFDBOARD-item-id's uit een board_relation-kolom. */
function linkedIds(item: MondayItem, columnId: string): string[] {
  const raw = rawVal(item, columnId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      linkedPulseIds?: Array<{ linkedPulseId: number | string }>;
      linkedItems?: Array<{ linkedPulseId?: number | string; id?: number | string }>;
    };
    const ids =
      parsed.linkedPulseIds?.map((x) => String(x.linkedPulseId)) ??
      parsed.linkedItems?.map((x) => String(x.linkedPulseId ?? x.id)) ??
      [];
    return ids.filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Laadt de actieve klanten uit het Monday HOOFDBOARD in ShortClips OS, met hun
 * contactpersonen (uit het contactenboard) en hun agenda-aliassen (de kolom
 * "Agenda-namen", die de agenda-matcher gebruikt). Idempotent: opnieuw draaien
 * werkt bestaande klanten bij in plaats van te dupliceren (op slug / externe id).
 */
export async function runMondayClientImport() {
  return runJob("monday", "monday.import_clients", {}, async (ctx) => {
    // Onze eigen gebruikers, om de accountmanager te kunnen koppelen.
    const internalUsers = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users);
    const userByName = new Map<string, string>();
    for (const u of internalUsers) {
      userByName.set(normalizeName(u.fullName), u.id);
      const first = u.fullName.split(" ")[0];
      if (first) userByName.set(normalizeName(first), u.id);
    }

    // 1) HOOFDBOARD → klanten.
    const hoofd = await monday.listItems(HOOFDBOARD, 200);
    const active = hoofd.filter((i) => col(i, H.status).toLowerCase().includes("actief klant"));
    ctx.log(`${active.length} actieve klanten van ${hoofd.length} in HOOFDBOARD`);

    const clientByMondayItem = new Map<string, string>(); // monday item id -> client id
    const clientBySlug = new Map<string, string>();

    for (const item of active) {
      ctx.counters.processed++;
      const name = item.name.trim();
      const slug = slugify(name);
      const revenue = parseMoney(col(item, H.revenue));
      const startText = col(item, H.startDate);
      const startedOn = /^\d{4}-\d{2}-\d{2}/.test(startText) ? startText.slice(0, 10) : null;
      const amName = col(item, H.accountManager);
      const coordinatorId = amName ? userByName.get(normalizeName(amName.split(",")[0])) ?? null : null;

      const base = {
        name,
        status: "active" as const,
        ...(revenue ? { monthlyRevenue: revenue } : {}),
        ...(startedOn ? { startedOn } : {}),
        ...(coordinatorId ? { coordinatorId } : {}),
        updatedAt: new Date(),
      };

      const [existing] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
      let clientId: string;
      if (existing) {
        await db.update(clients).set(base).where(eq(clients.id, existing.id));
        clientId = existing.id;
        ctx.counters.updated++;
      } else {
        const [created] = await db.insert(clients).values({ slug, ...base }).returning({ id: clients.id });
        clientId = created!.id;
        ctx.counters.created++;
      }
      clientByMondayItem.set(item.id, clientId);
      clientBySlug.set(slug, clientId);

      // Monday-koppeling vastleggen.
      await db.insert(clientIntegrations).values({
        clientId,
        provider: "monday",
        externalId: item.id,
        externalName: name,
        externalUrl: `https://shortclips.monday.com/boards/${HOOFDBOARD}/pulses/${item.id}`,
        lastSyncedAt: new Date(),
      }).onConflictDoUpdate({
        target: [clientIntegrations.clientId, clientIntegrations.provider, clientIntegrations.externalId],
        set: { externalName: name, lastSyncedAt: new Date(), updatedAt: new Date() },
      });

      // Agenda-aliassen voor de matcher: naam + de "Agenda-namen"-kolom.
      const agendaAliases = col(item, H.agendaNames)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const aliases = Array.from(new Set([name, ...agendaAliases]));
      await db.insert(clientIntegrations).values({
        clientId,
        provider: "google_calendar",
        externalId: slug,
        externalName: name,
        config: { aliases },
        lastSyncedAt: new Date(),
      }).onConflictDoUpdate({
        target: [clientIntegrations.clientId, clientIntegrations.provider, clientIntegrations.externalId],
        set: { config: { aliases }, lastSyncedAt: new Date(), updatedAt: new Date() },
      });
    }

    // 2) CONTACTPERSOON → contactpersonen, gekoppeld via de board-relation.
    const contactItems = await monday.listItems(CONTACTEN, 300);
    let contactsLinked = 0;
    for (const item of contactItems) {
      const links = linkedIds(item, C.relation);
      let clientId: string | null = null;
      for (const lid of links) {
        if (clientByMondayItem.has(lid)) { clientId = clientByMondayItem.get(lid)!; break; }
      }
      if (!clientId) {
        // Fallback: match op bedrijfsnaam.
        const bedrijf = col(item, C.bedrijf);
        if (bedrijf) {
          const nb = normalizeName(bedrijf);
          for (const [slug, cid] of clientBySlug) {
            if (normalizeName(slug) === nb || normalizeName(slug).includes(nb) || nb.includes(normalizeName(slug))) {
              clientId = cid; break;
            }
          }
        }
      }
      if (!clientId) continue; // hoort bij een niet-geïmporteerde (niet-actieve) klant

      const fullName = (col(item, C.naam) || item.name).trim();
      const email = col(item, C.email).toLowerCase() || null;
      const phone = col(item, C.phone) || null;
      const isPrimary = /ja|primair|hoofd/i.test(col(item, C.primary));
      if (!fullName && !email) continue;

      // Dedup op (clientId + e-mail) of (clientId + naam).
      const existing = await db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(and(eq(clientContacts.clientId, clientId), email ? eq(clientContacts.email, email) : eq(clientContacts.fullName, fullName)))
        .limit(1);

      if (existing[0]) {
        await db.update(clientContacts)
          .set({ fullName, email, phone, isPrimary, updatedAt: new Date() })
          .where(eq(clientContacts.id, existing[0].id));
      } else {
        await db.insert(clientContacts).values({ clientId, fullName, email, phone, isPrimary });
      }
      contactsLinked++;
    }

    ctx.log(`${contactsLinked} contactpersonen gekoppeld`);
    ctx.log(`Klaar: ${ctx.counters.created} nieuwe klanten, ${ctx.counters.updated} bijgewerkt.`);
  });
}
