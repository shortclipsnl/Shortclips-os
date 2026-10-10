import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Viewer } from "@/server/auth/context";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

const ACTIVE = sql`d.status not in ('published','analysis_available')`;
const DONE = sql`d.status in ('published','analysis_available')`;
const FEEDBACK = sql`d.status in ('client_review','client_revision')`;

export type EditorRow = {
  editor_id: string; editor_name: string; rate: number; capacity: number;
  in_production: number; awaiting_feedback: number; late: number; done_month: number;
  clients_active: number; next_due: string | null; cost_active: number;
};
export type EditingClientRow = {
  id: string; slug: string; name: string; color: string | null; quota: number; client_rate: number;
  editors: string | null; in_production: number; awaiting_feedback: number; done_month: number;
  late: number; next_due: string | null;
};

/** Overzicht voor het editing dashboard: per editor en per klant, incl. de
 *  automatisch berekende editingkosten (afwijkend tarief per project wint). */
export type LeaveWindow = { user_id: string; start_on: string; end_on: string };

export async function getEditingDashboard(_viewer: Viewer) {
  const [editorRes, clientRes, leaveRes] = await Promise.all([
    db.execute(sql`
      select u.id editor_id, u.full_name editor_name,
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
      group by u.id, u.full_name, er.rate_per_video, er.capacity_per_week
      order by in_production desc, editor_name
    `),
    db.execute(sql`
      select c.id, c.slug, c.name, c.color,
        coalesce(c.monthly_video_quota,0)::int quota, coalesce(c.edit_cost_per_video,0)::float client_rate,
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
      group by c.id, c.slug, c.name, c.color, c.monthly_video_quota, c.edit_cost_per_video
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
