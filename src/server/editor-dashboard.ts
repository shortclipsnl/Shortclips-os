import "server-only";
import { and, asc, count, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, tasks } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * De editoromgeving. Bewust smal: wat moet ik vandaag doen, wat is er van mij,
 * en hoe doe ik het. Geen klantoverzichten, geen omzet, geen werk van collega's.
 */
export async function getEditorDashboard(viewer: Viewer) {
  const [queue, overdue, stats, openTasks] = await Promise.all([
    db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        status: deliverables.status,
        statusChangedAt: deliverables.statusChangedAt,
        dueOn: deliverables.dueOn,
        briefing: deliverables.briefing,
        currentVersion: deliverables.currentVersion,
        clientRevisionRounds: deliverables.clientRevisionRounds,
        internalRevisionRounds: deliverables.internalRevisionRounds,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
        scriptId: deliverables.scriptId,
        driveFolderId: deliverables.driveFolderId,
        frameUrl: deliverables.frameUrl,
        openComments: sql<number>`(
          select count(*) from review_threads rt
          where rt.deliverable_id = deliverables.id
            and rt.is_resolved = false and rt.deleted_at is null
        )`,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          eq(deliverables.editorId, viewer.id),
          sql`${deliverables.status} in ('editing','editor_revision','awaiting_editor','internal_review','client_revision')`,
        ),
      )
      .orderBy(asc(deliverables.dueOn), asc(deliverables.statusChangedAt)),

    db
      .select({ total: count() })
      .from(deliverables)
      .where(
        and(
          isNull(deliverables.deletedAt),
          eq(deliverables.editorId, viewer.id),
          lt(deliverables.dueOn, today()),
          sql`${deliverables.status} in ('editing','editor_revision','awaiting_editor')`,
        ),
      ),

    // Eigen prestaties. Alleen objectieve cijfers, geen oordeel.
    db.execute(sql`
      select
        count(*) filter (where status in ('published','approved','scheduled','ready_to_publish','analysis_available'))::int as opgeleverd,
        count(*) filter (where status in ('editing','editor_revision'))::int as lopend,
        round(avg(internal_revision_rounds)::numeric, 2) as gem_intern,
        round(avg(client_revision_rounds)::numeric, 2) as gem_klant,
        count(*) filter (
          where published_at is not null and due_on is not null and published_at::date <= due_on
        )::int as op_tijd,
        count(*) filter (where published_at is not null and due_on is not null)::int as met_deadline
      from deliverables
      where editor_id = ${viewer.id} and deleted_at is null
    `),

    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueOn: tasks.dueOn,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          eq(tasks.assigneeId, viewer.id),
          sql`${tasks.status} in ('todo','in_progress','blocked')`,
        ),
      )
      .orderBy(asc(tasks.dueOn))
      .limit(10),
  ]);

  const row =
    ((stats as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
      (stats as unknown as Array<Record<string, unknown>>))[0] ?? {};

  const onTime = Number(row.op_tijd ?? 0);
  const withDeadline = Number(row.met_deadline ?? 0);

  return {
    queue,
    overdue: Number(overdue[0]?.total ?? 0),
    tasks: openTasks,
    stats: {
      delivered: Number(row.opgeleverd ?? 0),
      inProgress: Number(row.lopend ?? 0),
      avgInternalRevisions: row.gem_intern ? Number(row.gem_intern) : null,
      avgClientRevisions: row.gem_klant ? Number(row.gem_klant) : null,
      onTimeRate: withDeadline > 0 ? (onTime / withDeadline) * 100 : null,
      withDeadline,
    },
  };
}
