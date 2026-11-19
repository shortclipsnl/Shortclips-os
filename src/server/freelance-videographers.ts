import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, users, videographerContacts } from "@/db/schema";
import { isCoreStaff } from "@/server/core-staff";
import { normName } from "@/lib/editor-database";
import {
  availabilityState,
  missingFields,
  normalizeLabels,
  normalizeLinks,
  REGIONS,
  SPECIALISATIONS,
  type VideographerLink,
  type VideographerNote,
} from "@/lib/freelance-videographers";

export type VideographerWorkStats = {
  total: number;
  past: number;
  clients: number;
  lastWorkOn: string | null;
  nextWorkOn: string | null;
  recentClients: string[];
};

export type VideographerProfile = {
  id: string;
  fullName: string;
  photo: string | null;
  city: string | null;
  regions: string[];
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  portfolioUrl: string | null;
  links: VideographerLink[];
  specialisations: string[];
  status: string;
  availability: string;
  availabilityNote: string | null;
  availabilityConfirmedAt: string | null;
  availabilityConfirmedBy: string | null;
  availabilityStatus: "bevestigd" | "verouderd" | "onbekend";
  availabilityDays: number | null;
  dayRate: number | null;
  hourlyRate: number | null;
  rateNote: string | null;
  collaborationNote: string | null;
  notes: VideographerNote[];
  missing: string[];
  source: string;
  sourceLabel: string | null;
  linkedUser: boolean;
  stats: VideographerWorkStats | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type VideographerHistoryItem = { at: string; by: string; action: string; fields: string[] };

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const rowsOf = <T,>(res: unknown): T[] => ((res as { rows?: T[] }).rows ?? []);

/**
 * Zorgt dat elk bestaand videograafaccount in het portaal (freelance, geen
 * kernteam) een profiel heeft, zodat de lijst niet leeg begint en niets dubbel
 * wordt ingevoerd. Idempotent: een account met een (ook gearchiveerd) profiel
 * wordt nooit opnieuw aangemaakt; de unieke index op `user_id` borgt dat ook bij
 * twee gelijktijdige aanvragen.
 *
 *  - Een profiel dat het team al handmatig had (zelfde volledige naam, of alleen
 *    een voornaam die hetzelfde is) wordt aan het account gekoppeld in plaats van
 *    dubbel aangemaakt.
 *  - Actief account → Geselecteerd, niet-actief account → Niet actief.
 *  - Beschikbaarheid, tarief en regio worden nooit verzonnen: blijven leeg.
 */
export async function syncPortalVideographers(): Promise<void> {
  const res = await db.execute(sql`
    select u.id, u.full_name as "fullName", u.email, u.phone, u.status
    from users u
    where u.deleted_at is null and u.primary_role = 'videographer'
      and not exists (select 1 from videographer_contacts vc where vc.user_id = u.id)
  `);
  const accounts = rowsOf<{ id: string; fullName: string; email: string; phone: string | null; status: string }>(res).filter((u) => !isCoreStaff(u.email));
  if (!accounts.length) return;

  const unlinked = await db
    .select()
    .from(videographerContacts)
    .where(and(isNull(videographerContacts.deletedAt), isNull(videographerContacts.userId)));

  for (const u of accounts) {
    const full = normName(u.fullName);
    const first = full.split(" ")[0] ?? "";
    const match = unlinked.find((c) => normName(c.fullName) === full) ?? unlinked.find((c) => !normName(c.fullName).includes(" ") && normName(c.fullName) === first);
    const email = /@shortclips\.nl$/i.test(u.email) || /example|test/i.test(u.email) ? null : u.email;
    const status = u.status === "active" ? "geselecteerd" : "niet_actief";
    if (match) {
      await db
        .update(videographerContacts)
        .set({
          userId: u.id,
          fullName: normName(match.fullName).includes(" ") ? match.fullName : u.fullName,
          email: match.email ?? email,
          phone: match.phone ?? u.phone,
          status: match.status === "in_gesprek" ? status : match.status,
          sourceLabel: `${match.sourceLabel ? `${match.sourceLabel} · ` : ""}Gekoppeld aan videograafaccount in het portaal`.slice(0, 200),
          lastChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(videographerContacts.id, match.id));
      unlinked.splice(unlinked.indexOf(match), 1);
      continue;
    }
    await db
      .insert(videographerContacts)
      .values({ fullName: u.fullName, email, phone: u.phone, status, source: "portaal", sourceLabel: "Bestaand videograafaccount in het portaal", userId: u.id })
      .onConflictDoNothing();
  }
}

async function loadStats(userIds: string[]): Promise<Map<string, VideographerWorkStats>> {
  const map = new Map<string, VideographerWorkStats>();
  if (!userIds.length) return map;
  const res = await db.execute(sql`
    select pd.videographer_id as "userId",
      count(*)::int as total,
      count(*) filter (where pd.scheduled_on <= current_date)::int as past,
      count(distinct pd.client_id)::int as clients,
      max(pd.scheduled_on) filter (where pd.scheduled_on <= current_date)::text as "lastWorkOn",
      min(pd.scheduled_on) filter (where pd.scheduled_on > current_date)::text as "nextWorkOn",
      (array_agg(distinct c.name) filter (where c.name is not null))[1:4] as "recentClients"
    from production_days pd
    left join clients c on c.id = pd.client_id
    where pd.deleted_at is null and pd.videographer_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})
    group by pd.videographer_id
  `);
  for (const r of rowsOf<VideographerWorkStats & { userId: string }>(res)) {
    map.set(r.userId, { total: r.total, past: r.past, clients: r.clients, lastWorkOn: r.lastWorkOn, nextWorkOn: r.nextWorkOn, recentClients: r.recentClients ?? [] });
  }
  return map;
}

export async function listVideographerProfiles(): Promise<VideographerProfile[]> {
  await syncPortalVideographers();
  const confirmer = sql<string | null>`(select full_name from users cu where cu.id = ${videographerContacts.availabilityConfirmedById})`;
  const updater = sql<string | null>`(select full_name from users uu where uu.id = ${videographerContacts.updatedById})`;
  const rows = await db
    .select({ c: videographerContacts, confirmedBy: confirmer, updatedBy: updater })
    .from(videographerContacts)
    .where(isNull(videographerContacts.deletedAt))
    .orderBy(videographerContacts.fullName);
  const stats = await loadStats(rows.map((r) => r.c.userId).filter((v): v is string => !!v));
  const today = new Date();
  return rows.map(({ c, confirmedBy, updatedBy }) => {
    const links = normalizeLinks(c.links);
    const specialisations = normalizeLabels(c.specialisations, SPECIALISATIONS);
    const regions = normalizeLabels(c.regions, REGIONS);
    const av = availabilityState(c.availability, c.availabilityConfirmedAt, today);
    return {
      id: c.id,
      fullName: c.fullName,
      photo: c.photo,
      city: c.city,
      regions,
      phone: c.phone,
      whatsapp: c.whatsapp,
      email: c.email,
      portfolioUrl: c.portfolioUrl,
      links,
      specialisations,
      status: c.status,
      availability: c.availability,
      availabilityNote: c.availabilityNote,
      availabilityConfirmedAt: c.availabilityConfirmedAt,
      availabilityConfirmedBy: confirmedBy,
      availabilityStatus: av.status,
      availabilityDays: av.days,
      dayRate: c.dayRate,
      hourlyRate: c.hourlyRate,
      rateNote: c.rateNote,
      collaborationNote: c.collaborationNote,
      notes: asArray<VideographerNote>(c.notes).sort((a, b) => b.at.localeCompare(a.at)),
      missing: missingFields({ ...c, regions, links, specialisations }),
      source: c.source,
      sourceLabel: c.sourceLabel,
      linkedUser: !!c.userId,
      stats: c.userId ? stats.get(c.userId) ?? null : null,
      updatedAt: c.lastChangedAt.toISOString(),
      updatedBy,
    };
  });
}

/** Wijzigingshistorie per freelancer uit de audit log (wie, wanneer, welke velden). */
export async function listVideographerHistory(ids: string[]): Promise<Record<string, VideographerHistoryItem[]>> {
  const out: Record<string, VideographerHistoryItem[]> = {};
  if (!ids.length) return out;
  const rows = await db
    .select({ entityId: auditLogs.entityId, at: auditLogs.occurredAt, by: users.fullName, email: auditLogs.actorEmail, action: auditLogs.action, changes: auditLogs.changes })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(and(eq(auditLogs.entityType, "videographer_contact"), inArray(auditLogs.entityId, ids)))
    .orderBy(desc(auditLogs.occurredAt))
    .limit(1500);
  for (const r of rows) {
    if (!r.entityId) continue;
    const list = (out[r.entityId] ??= []);
    if (list.length >= 12) continue;
    const ch = (r.changes ?? {}) as { fields?: unknown };
    list.push({ at: r.at.toISOString(), by: r.by ?? r.email ?? "Onbekend", action: r.action, fields: asArray<string>(ch.fields) });
  }
  return out;
}
