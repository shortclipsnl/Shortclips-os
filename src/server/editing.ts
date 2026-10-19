import "server-only";
import { and, desc, eq, gte, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { editorCapacityMap } from "@/server/metrics";
import { editorLoad } from "@/lib/metrics";
import { workingDaysBetween } from "@/lib/workdays";
import { projectRisk, type RiskLevel } from "@/server/risk";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

const ACTIVE = sql`d.status not in ('published','analysis_available')`;
const DONE = sql`d.status in ('published','analysis_available')`;
const FEEDBACK = sql`d.status in ('client_review','client_revision')`;

export type EditorRow = {
  editor_id: string; editor_name: string; avatar_url: string | null; rate: number; capacity: number;
  in_production: number; awaiting_feedback: number; late: number; done_month: number;
  clients_active: number; next_due: string | null; cost_active: number;
};
export type EditingClientRow = {
  id: string; slug: string; name: string; color: string | null; logo_url: string | null; quota: number; client_rate: number;
  editors: string | null; assigned_editor: string | null; in_production: number; awaiting_feedback: number; done_month: number;
  late: number; next_due: string | null;
};

/** Overzicht voor het editing dashboard: per editor en per klant, incl. de
 *  automatisch berekende editingkosten (afwijkend tarief per project wint). */
export type LeaveWindow = { user_id: string; start_on: string; end_on: string };

export async function getEditingDashboard(_viewer: Viewer) {
  const [editorRes, clientRes, leaveRes] = await Promise.all([
    db.execute(sql`
      select u.id editor_id, u.full_name editor_name, u.avatar_url,
        coalesce(er.rate_per_video,0)::float rate, coalesce(er.capacity_per_week,0)::int capacity,
        count(*) filter (where ${ACTIVE}) in_production,
        count(*) filter (where ${FEEDBACK}) awaiting_feedback,
        count(*) filter (where d.due_on < current_date and ${ACTIVE}) late,
        count(*) filter (where ${DONE} and d.published_at >= date_trunc('month', now())) done_month,
        count(distinct d.client_id) filter (where ${ACTIVE}) clients_active,
        min(d.due_on) filter (where d.due_on >= current_date and ${ACTIVE}) next_due,
        coalesce(sum(case when d.edit_cost > 0 then d.edit_cost else coalesce(er.rate_per_video,0) end) filter (where ${ACTIVE}),0)::float cost_active
      from users u
      join deliverables d on d.editor_id = u.id and d.deleted_at is null
      left join editor_rates er on er.user_id = u.id
      group by u.id, u.full_name, u.avatar_url, er.rate_per_video, er.capacity_per_week
      order by in_production desc, editor_name
    `),
    db.execute(sql`
      select c.id, c.slug, c.name, c.color, c.logo_url,
        coalesce(c.monthly_video_quota,0)::int quota, coalesce(c.edit_cost_per_video,0)::float client_rate,
        c.editor_name assigned_editor,
        string_agg(distinct u.full_name, ', ') filter (where ${ACTIVE}) editors,
        count(*) filter (where ${ACTIVE}) in_production,
        count(*) filter (where ${FEEDBACK}) awaiting_feedback,
        count(*) filter (where ${DONE} and d.published_at >= date_trunc('month', now())) done_month,
        count(*) filter (where d.due_on < current_date and ${ACTIVE}) late,
        min(d.due_on) filter (where d.due_on >= current_date and ${ACTIVE}) next_due
      from clients c
      left join deliverables d on d.client_id = c.id and d.deleted_at is null
      left join users u on u.id = d.editor_id
      where c.deleted_at is null and c.status = 'active'
      group by c.id, c.slug, c.name, c.color, c.logo_url, c.monthly_video_quota, c.edit_cost_per_video, c.editor_name
      order by in_production desc, name
    `),
    // Goedgekeurd verlof dat nu of binnen 14 dagen speelt — zodat je bij het
    // verdelen van editwerk rekening kunt houden met afwezigheid.
    db.execute(sql`
      select user_id, min(start_on) start_on, max(end_on) end_on
      from leave_requests
      where status = 'approved' and end_on >= current_date and start_on <= current_date + interval '14 days'
      group by user_id
    `),
  ]);

  const leaveByUser = new Map<string, LeaveWindow>();
  for (const l of rows<LeaveWindow>(leaveRes)) leaveByUser.set(l.user_id, l);

  return {
    editors: rows<EditorRow>(editorRes).map((e) => ({ ...e, leave: leaveByUser.get(e.editor_id) ?? null })),
    clients: rows<EditingClientRow>(clientRes),
  };
}

/* ---- Project-gerichte lijst voor het editing-dashboard (§4) ---- */

export type EditingBucket = "aandacht" | "editor" | "klant" | "afgerond";
export type EditingProject = {
  id: string;
  title: string;
  status: string;
  clientName: string;
  clientColor: string | null;
  clientLogo: string | null;
  clientSlug: string;
  editorName: string | null;
  dueOn: string | null;
  bucket: EditingBucket;
  isLate: boolean;
  daysToDeadline: number | null;
  risk: { level: RiskLevel; factors: string[] };
};

const CLIENT_STATUSES = ["client_review", "client_revision"];
const DONE_STATUSES = ["approved", "ready_to_publish", "scheduled", "published", "analysis_available"];

/** Alle video's die relevant zijn voor de editingproductie, per status gebucket.
 *  Gescoped: editors zien uitsluitend eigen werk; coördinatoren hun klanten. */
export async function listEditingProjects(viewer: Viewer): Promise<EditingProject[]> {
  const conds = [
    isNull(deliverables.deletedAt),
    scopeToClients(viewer, deliverables.clientId),
    // Actief, óf recent afgerond (laatste 30 dagen) zodat de "Afgerond"-kolom gevuld is.
    or(
      notInArray(deliverables.status, ["published", "analysis_available"] as const),
      gte(deliverables.publishedAt, sql`now() - interval '30 days'`),
    ),
  ];
  if (viewer.isEditorOnly) conds.push(eq(deliverables.editorId, viewer.id));

  const [rawRows, capMap] = await Promise.all([
    db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        status: deliverables.status,
        dueOn: deliverables.dueOn,
        statusChangedAt: deliverables.statusChangedAt,
        clientName: clients.name,
        clientColor: clients.color,
        clientLogo: clients.logoUrl,
        clientSlug: clients.slug,
        editorId: deliverables.editorId,
        editorName: users.fullName,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(...conds))
      .orderBy(sql`${deliverables.dueOn} asc nulls last`, desc(deliverables.statusChangedAt))
      .limit(500),
    editorCapacityMap(),
  ]);

  // Actieve werkvoorraad per editor → overbelasting (voor de risicofactor).
  const openByEditor = new Map<string, number>();
  for (const r of rawRows) {
    if (r.editorId && !DONE_STATUSES.includes(r.status)) openByEditor.set(r.editorId, (openByEditor.get(r.editorId) ?? 0) + 1);
  }
  const overloaded = new Set<string>();
  for (const [eid, open] of openByEditor) {
    if (editorLoad(open, capMap.get(eid) ?? 0).level === "overbelast") overloaded.add(eid);
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  return rawRows.map((r) => {
    // Te laat = deadline verstreken en het editwerk is nog niet afgerond.
    const isLate = Boolean(r.dueOn && r.dueOn < today && !DONE_STATUSES.includes(r.status));
    let bucket: EditingBucket;
    if (isLate) bucket = "aandacht";
    else if (DONE_STATUSES.includes(r.status)) bucket = "afgerond";
    else if (CLIENT_STATUSES.includes(r.status)) bucket = "klant";
    else bucket = "editor";
    const daysToDeadline = r.dueOn ? Math.round((new Date(r.dueOn).getTime() - new Date(today).getTime()) / 86400000) : null;
    const daysAtClient = CLIENT_STATUSES.includes(r.status) && r.statusChangedAt
      ? workingDaysBetween(new Date(r.statusChangedAt).toLocaleDateString("en-CA"), today)
      : null;
    const risk = projectRisk({
      isLate, daysToDeadline, status: r.status,
      editorOverloaded: r.editorId ? overloaded.has(r.editorId) : false,
      daysAtClient,
    });
    return {
      id: r.id, title: r.title, status: r.status,
      clientName: r.clientName, clientColor: r.clientColor, clientLogo: r.clientLogo, clientSlug: r.clientSlug,
      editorName: r.editorName, dueOn: r.dueOn,
      bucket, isLate, daysToDeadline, risk,
    };
  });
}

/** Lijst van editors (users die video's monteren of editor-rol hebben) + hun tarief. */
export async function listEditorsWithRates() {
  const res = await db.execute(sql`
    select u.id, u.full_name name,
      coalesce(er.rate_per_video,0)::float rate, coalesce(er.capacity_per_week,0)::int capacity,
      (er.user_id is not null) has_rate
    from users u
    left join editor_rates er on er.user_id = u.id
    where u.deleted_at is null and u.status = 'active'
      and (u.primary_role = 'editor' or exists (select 1 from deliverables d where d.editor_id = u.id and d.deleted_at is null))
    order by u.full_name
  `);
  return rows<{ id: string; name: string; rate: number; capacity: number; has_rate: boolean }>(res);
}
