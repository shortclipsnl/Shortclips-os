import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, editorContacts, editorRates, users } from "@/db/schema";
import { defaultEditorRate, isBoardEditorName } from "@/lib/editors";
import {
  availabilityState,
  missingFields,
  normalizeLinks,
  normalizeSpecialisations,
  type EditorLink,
  type EditorNote,
} from "@/lib/editor-database";

export type EditorWorkStats = {
  total: number;
  done: number;
  inProduction: number;
  clients: number;
  lastWorkOn: string | null;
  recentClients: string[];
};

export type EditorProfile = {
  id: string;
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  portfolioUrl: string | null;
  links: EditorLink[];
  specialisations: string[];
  category: string;
  workedWithUs: string;
  collaborationNote: string | null;
  ratePerVideo: number | null;
  rateNote: string | null;
  /** Tarief uit Editkosten voor gekoppelde editors (als het profiel er zelf geen heeft). */
  knownRate: number | null;
  availability: string;
  availabilityNote: string | null;
  availabilityConfirmedAt: string | null;
  availabilityConfirmedBy: string | null;
  availabilityStatus: "bevestigd" | "verouderd" | "onbekend";
  availabilityDays: number | null;
  ratingQuality: number | null;
  ratingCollaboration: number | null;
  favorite: boolean;
  notes: EditorNote[];
  unverifiedFields: string[];
  missing: string[];
  source: string;
  sourceLabel: string | null;
  linkedUser: boolean;
  stats: EditorWorkStats | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type EditorHistoryItem = { at: string; by: string; action: string; fields: string[] };

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Zorgt dat elke bestaande editor uit het portaal een profiel heeft, zodat de
 * database niet leeg begint en niets dubbel wordt ingevoerd. Idempotent: een
 * editor met een (ook gearchiveerd) profiel wordt nooit opnieuw aangemaakt.
 *
 *  - de vaste board-editors → Actief, eerder voor ons gewerkt;
 *  - overige accounts die ooit een video monteerden → Back up, met de
 *    categorie als "nog te bevestigen" (we weten niet of het goed ging).
 */
export async function syncPortalEditors(): Promise<void> {
  const res = await db.execute(sql`
    select u.id, u.full_name as "fullName", u.email, u.phone, u.status,
      exists (select 1 from deliverables d where d.editor_id = u.id and d.deleted_at is null) as "hasWork"
    from users u
    where u.deleted_at is null and u.primary_role = 'editor'
      and not exists (select 1 from editor_contacts ec where ec.user_id = u.id)
  `);
  const rows = ((res as unknown as { rows?: { id: string; fullName: string; email: string; phone: string | null; status: string; hasWork: boolean }[] }).rows ?? []);
  const toInsert = rows
    .filter((u) => (isBoardEditorName(u.fullName) && u.status === "active") || u.hasWork)
    .map((u) => {
      const board = isBoardEditorName(u.fullName) && u.status === "active";
      const email = /@shortclips\.nl$/i.test(u.email) || /example|test/i.test(u.email) ? null : u.email;
      return {
        fullName: u.fullName,
        email,
        phone: u.phone,
        category: board ? "actief" : "backup",
        workedWithUs: "ja",
        source: "portaal",
        sourceLabel: "Bestaand editoraccount in het portaal",
        userId: u.id,
        unverifiedFields: board ? [] : ["category"],
      };
    });
  if (toInsert.length) await db.insert(editorContacts).values(toInsert);
}

async function loadStats(userIds: string[]): Promise<Map<string, EditorWorkStats>> {
  const map = new Map<string, EditorWorkStats>();
  if (!userIds.length) return map;
  const res = await db.execute(sql`
    select d.editor_id as "userId",
      count(*)::int as total,
      count(*) filter (where d.status in ('published','analysis_available'))::int as done,
      count(*) filter (where d.status not in ('published','analysis_available'))::int as "inProduction",
      count(distinct d.client_id)::int as clients,
      max(coalesce(d.published_at::date, d.due_on))::text as "lastWorkOn",
      (array_agg(distinct c.name) filter (where c.name is not null))[1:4] as "recentClients"
    from deliverables d
    left join clients c on c.id = d.client_id
    where d.deleted_at is null and d.editor_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})
    group by d.editor_id
  `);
  for (const r of ((res as unknown as { rows?: (EditorWorkStats & { userId: string })[] }).rows ?? [])) {
    map.set(r.userId, { total: r.total, done: r.done, inProduction: r.inProduction, clients: r.clients, lastWorkOn: r.lastWorkOn, recentClients: r.recentClients ?? [] });
  }
  return map;
}

export async function listEditorProfiles(): Promise<EditorProfile[]> {
  await syncPortalEditors();
  const confirmer = sql<string | null>`(select full_name from users cu where cu.id = ${editorContacts.availabilityConfirmedById})`;
  const updater = sql<string | null>`(select full_name from users uu where uu.id = ${editorContacts.updatedById})`;
  const rows = await db
    .select({ c: editorContacts, confirmedBy: confirmer, updatedBy: updater, linkedRate: editorRates.ratePerVideo, linkedName: users.fullName })
    .from(editorContacts)
    .leftJoin(editorRates, eq(editorRates.userId, editorContacts.userId))
    .leftJoin(users, eq(users.id, editorContacts.userId))
    .where(isNull(editorContacts.deletedAt))
    .orderBy(editorContacts.fullName);
  const stats = await loadStats(rows.map((r) => r.c.userId).filter((v): v is string => !!v));
  const today = new Date();
  return rows.map(({ c, confirmedBy, updatedBy, linkedRate, linkedName }) => {
    const links = normalizeLinks(c.links);
    const specialisations = normalizeSpecialisations(c.specialisations);
    const dbRate = linkedRate != null ? Number(linkedRate) : 0;
    const knownRate = c.userId ? (dbRate > 0 ? dbRate : defaultEditorRate(linkedName) || null) : null;
    const av = availabilityState(c.availability, c.availabilityConfirmedAt, today);
    return {
      id: c.id,
      fullName: c.fullName,
      phone: c.phone,
      whatsapp: c.whatsapp,
      email: c.email,
      portfolioUrl: c.portfolioUrl,
      links,
      specialisations,
      category: c.category,
      workedWithUs: c.workedWithUs,
      collaborationNote: c.collaborationNote,
      ratePerVideo: c.ratePerVideo,
      rateNote: c.rateNote,
      knownRate,
      availability: c.availability,
      availabilityNote: c.availabilityNote,
      availabilityConfirmedAt: c.availabilityConfirmedAt,
      availabilityConfirmedBy: confirmedBy,
      availabilityStatus: av.status,
      availabilityDays: av.days,
      ratingQuality: c.ratingQuality,
      ratingCollaboration: c.ratingCollaboration,
      favorite: c.favorite,
      notes: asArray<EditorNote>(c.notes).sort((a, b) => b.at.localeCompare(a.at)),
      unverifiedFields: asArray<string>(c.unverifiedFields),
      missing: missingFields({ ...c, links, specialisations, knownRate }),
      source: c.source,
      sourceLabel: c.sourceLabel,
      linkedUser: !!c.userId,
      stats: c.userId ? stats.get(c.userId) ?? null : null,
      updatedAt: c.lastChangedAt.toISOString(),
      updatedBy,
    };
  });
}

/** Wijzigingshistorie per editor uit de audit log (wie, wanneer, welke velden). */
export async function listEditorHistory(ids: string[]): Promise<Record<string, EditorHistoryItem[]>> {
  const out: Record<string, EditorHistoryItem[]> = {};
  if (!ids.length) return out;
  const rows = await db
    .select({ entityId: auditLogs.entityId, at: auditLogs.occurredAt, by: users.fullName, email: auditLogs.actorEmail, action: auditLogs.action, changes: auditLogs.changes })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(and(eq(auditLogs.entityType, "editor_contact"), inArray(auditLogs.entityId, ids)))
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
