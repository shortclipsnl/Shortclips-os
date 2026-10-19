import "server-only";
import { notFound } from "next/navigation";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  approvals,
  clients,
  deliverables,
  productionDays,
  reviewComments,
  reviewThreads,
  scripts,
  users,
  videoVersions,
} from "@/db/schema";
import {
  assertClientAccess,
  scopeToClients,
  type Viewer,
} from "@/server/auth/context";
import { VIDEO_STAGES, type VideoStage } from "@/lib/statuses";

export type VideoFilter = {
  status?: string;
  clientSlug?: string;
  editorId?: string;
  preset?: "te-laat" | "bij-klant" | "mijn-werk" | "actief";
};

export async function listVideos(viewer: Viewer, filter: VideoFilter = {}) {
  const conditions = [isNull(deliverables.deletedAt), scopeToClients(viewer, deliverables.clientId)];

  // Een editor ziet uitsluitend eigen toegewezen video's — ook binnen een klant
  // waar hij verder wel toegang toe heeft.
  if (viewer.isEditorOnly) conditions.push(eq(deliverables.editorId, viewer.id));

  if (filter.status && VIDEO_STAGES.includes(filter.status as VideoStage)) {
    conditions.push(eq(deliverables.status, filter.status as VideoStage));
  }
  if (filter.clientSlug) conditions.push(eq(clients.slug, filter.clientSlug));
  if (filter.editorId) conditions.push(eq(deliverables.editorId, filter.editorId));

  if (filter.preset === "te-laat") {
    conditions.push(lt(deliverables.dueOn, new Date().toISOString().slice(0, 10)));
    conditions.push(
      inArray(deliverables.status, VIDEO_STAGES.filter((s) => s !== "published" && s !== "analysis_available")),
    );
  } else if (filter.preset === "bij-klant") {
    conditions.push(inArray(deliverables.status, ["client_review", "client_revision"]));
  } else if (filter.preset === "mijn-werk") {
    conditions.push(eq(deliverables.editorId, viewer.id));
  } else if (filter.preset === "actief") {
    conditions.push(
      inArray(deliverables.status, VIDEO_STAGES.filter((s) => s !== "published" && s !== "analysis_available")),
    );
  }

  return db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      status: deliverables.status,
      statusChangedAt: deliverables.statusChangedAt,
      dueOn: deliverables.dueOn,
      plannedPublishOn: deliverables.plannedPublishOn,
      currentVersion: deliverables.currentVersion,
      internalRevisionRounds: deliverables.internalRevisionRounds,
      clientRevisionRounds: deliverables.clientRevisionRounds,
      publishedAt: deliverables.publishedAt,
      clientId: deliverables.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      editorId: deliverables.editorId,
      editorName: users.fullName,
      openComments: sql<number>`(
        select count(*) from review_threads rt
        where rt.deliverable_id = deliverables.id
          and rt.is_resolved = false and rt.deleted_at is null
      )`,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(users, eq(users.id, deliverables.editorId))
    .where(and(...conditions))
    .orderBy(asc(deliverables.dueOn), desc(deliverables.statusChangedAt))
    .limit(400);
}

/** Editors voor de inline-keuzelijst: expliciete editors én iedereen die al
 *  eens een video heeft geëdit. */
export async function listEditorOptions(): Promise<{ id: string; fullName: string; avatarUrl: string | null }[]> {
  const res = await db.execute(sql`
    select u.id, u.full_name as "fullName", u.avatar_url as "avatarUrl"
    from users u
    where u.deleted_at is null and u.status = 'active'
      and (u.primary_role = 'editor' or exists (
        select 1 from deliverables d where d.editor_id = u.id and d.deleted_at is null
      ))
    order by u.full_name
  `);
  return ((res as unknown as { rows?: { id: string; fullName: string; avatarUrl: string | null }[] }).rows ?? []);
}

/** Aandachtscijfers voor de highlight-blokken boven de videolijst. Respecteert
 *  klantscope en editor-only, net als listVideos. Voedt zich uit Monday (fase +
 *  deadline) via de deliverables-tabel. */
export async function getVideoHighlights(viewer: Viewer) {
  const base = [isNull(deliverables.deletedAt), scopeToClients(viewer, deliverables.clientId)];
  if (viewer.isEditorOnly) base.push(eq(deliverables.editorId, viewer.id));
  const today = new Date().toISOString().slice(0, 10);

  const activeStages = VIDEO_STAGES.filter((s) => s !== "published" && s !== "analysis_available");
  const base2 = {
    id: deliverables.id,
    title: deliverables.title,
    clientName: clients.name,
    clientSlug: clients.slug,
    clientColor: clients.color,
    editorName: users.fullName,
  };
  const overdueDays = { ...base2, days: sql<number>`(current_date - ${deliverables.dueOn})` };
  const stuckDays = { ...base2, days: sql<number>`floor(extract(epoch from (now() - ${deliverables.statusChangedAt})) / 86400)::int` };

  const [row, lateList, atClientList, awaitingEditorList] = await Promise.all([
    db
      .select({
        late: sql<number>`count(*) filter (where ${deliverables.dueOn} < ${today} and ${deliverables.status} not in ('published','analysis_available'))`,
        atClient: sql<number>`count(*) filter (where ${deliverables.status} in ('client_review','client_revision'))`,
        awaitingEditor: sql<number>`count(*) filter (where ${deliverables.status} = 'awaiting_editor')`,
        inProduction: sql<number>`count(*) filter (where ${deliverables.status} not in ('published','analysis_available'))`,
        oldestAtClient: sql<number>`coalesce(max(extract(day from now() - ${deliverables.statusChangedAt})) filter (where ${deliverables.status} in ('client_review','client_revision')), 0)`,
      })
      .from(deliverables)
      .where(and(...base)),
    db
      .select(overdueDays)
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(...base, lt(deliverables.dueOn, today), inArray(deliverables.status, activeStages)))
      .orderBy(asc(deliverables.dueOn))
      .limit(8),
    db
      .select(stuckDays)
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(...base, inArray(deliverables.status, ["client_review", "client_revision"])))
      .orderBy(asc(deliverables.statusChangedAt))
      .limit(8),
    db
      .select(stuckDays)
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(...base, eq(deliverables.status, "awaiting_editor")))
      .orderBy(asc(deliverables.statusChangedAt))
      .limit(8),
  ]);

  return {
    late: Number(row[0]?.late ?? 0),
    atClient: Number(row[0]?.atClient ?? 0),
    awaitingEditor: Number(row[0]?.awaitingEditor ?? 0),
    inProduction: Number(row[0]?.inProduction ?? 0),
    oldestAtClientDays: Math.round(Number(row[0]?.oldestAtClient ?? 0)),
    lateList,
    atClientList,
    awaitingEditorList,
  };
}

/**
 * "Video's om te checken": alles wat rondom de interne controle speelt.
 * - teControleren: klaar voor interne controle (internal_review)
 * - feedbackOntvangen: interne feedback gegeven, editor past aan (editor_revision)
 * - goedgekeurd: intern goedgekeurd (approved), recent
 * Elk met de Frame.io-link, zodat je direct naar de juiste video doorklikt.
 */
export async function getReviewQueue(viewer: Viewer) {
  const base = [isNull(deliverables.deletedAt), scopeToClients(viewer, deliverables.clientId)];
  if (viewer.isEditorOnly) base.push(eq(deliverables.editorId, viewer.id));

  const cols = {
    id: deliverables.id,
    title: deliverables.title,
    status: deliverables.status,
    statusChangedAt: deliverables.statusChangedAt,
    dueOn: deliverables.dueOn,
    frameUrl: deliverables.frameUrl,
    clientName: clients.name,
    clientSlug: clients.slug,
    clientColor: clients.color,
    clientLogo: clients.logoUrl,
    editorName: users.fullName,
    openComments: sql<number>`(
      select count(*) from review_threads rt
      where rt.deliverable_id = ${deliverables.id}
        and rt.is_resolved = false and rt.deleted_at is null
    )`,
    days: sql<number>`floor(extract(epoch from (now() - ${deliverables.statusChangedAt})) / 86400)::int`,
  };

  const forStatuses = (statuses: VideoStage[], order: "asc" | "desc") =>
    db
      .select(cols)
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(...base, inArray(deliverables.status, statuses)))
      .orderBy(order === "asc" ? asc(deliverables.statusChangedAt) : desc(deliverables.statusChangedAt))
      .limit(30);

  const [teControleren, feedbackOntvangen, goedgekeurd] = await Promise.all([
    forStatuses(["internal_review"], "asc"),
    forStatuses(["editor_revision"], "asc"),
    forStatuses(["approved"], "desc"),
  ]);

  return { teControleren, feedbackOntvangen, goedgekeurd };
}

export type ReviewQueueItem = Awaited<ReturnType<typeof getReviewQueue>>["teControleren"][number];

export type VideoRow = Awaited<ReturnType<typeof listVideos>>[number];

export async function getVideo(viewer: Viewer, id: string) {
  const [video] = await db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      status: deliverables.status,
      statusChangedAt: deliverables.statusChangedAt,
      dueOn: deliverables.dueOn,
      plannedPublishOn: deliverables.plannedPublishOn,
      briefing: deliverables.briefing,
      aspectRatio: deliverables.aspectRatio,
      durationSeconds: deliverables.durationSeconds,
      currentVersion: deliverables.currentVersion,
      internalRevisionRounds: deliverables.internalRevisionRounds,
      clientRevisionRounds: deliverables.clientRevisionRounds,
      editCost: deliverables.editCost,
      approvedAt: deliverables.approvedAt,
      publishedAt: deliverables.publishedAt,
      frameUrl: deliverables.frameUrl,
      frameAssetId: deliverables.frameAssetId,
      driveFolderId: deliverables.driveFolderId,
      clientId: deliverables.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      editorId: deliverables.editorId,
      editorName: users.fullName,
      scriptId: deliverables.scriptId,
      scriptTitle: scripts.title,
      productionDayId: deliverables.productionDayId,
      shootOn: productionDays.scheduledOn,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(users, eq(users.id, deliverables.editorId))
    .leftJoin(scripts, eq(scripts.id, deliverables.scriptId))
    .leftJoin(productionDays, eq(productionDays.id, deliverables.productionDayId))
    .where(and(eq(deliverables.id, id), isNull(deliverables.deletedAt)))
    .limit(1);

  if (!video) notFound();
  assertClientAccess(viewer, video.clientId);

  // Editors zien alleen video's die aan hen zijn toegewezen.
  if (viewer.isEditorOnly && video.editorId !== viewer.id) notFound();

  const canSeeInternal = viewer.permissions.has("comments:read_internal");

  const [versions, threads, approvalRows, editorList] = await Promise.all([
    db.select().from(videoVersions)
      .where(eq(videoVersions.deliverableId, id))
      .orderBy(desc(videoVersions.versionNumber)),

    db.select({
      id: reviewThreads.id,
      visibility: reviewThreads.visibility,
      timecodeMs: reviewThreads.timecodeMs,
      isResolved: reviewThreads.isResolved,
      createdAt: reviewThreads.createdAt,
      videoVersionId: reviewThreads.videoVersionId,
    })
      .from(reviewThreads)
      .where(
        and(
          eq(reviewThreads.deliverableId, id),
          isNull(reviewThreads.deletedAt),
          // Zonder recht op interne opmerkingen zie je alleen de klantdraden.
          canSeeInternal ? undefined : eq(reviewThreads.visibility, "client"),
        ),
      )
      .orderBy(asc(reviewThreads.createdAt)),

    db.select().from(approvals)
      .where(and(eq(approvals.kind, "video"), eq(approvals.entityId, id)))
      .orderBy(desc(approvals.requestedAt)),

    viewer.permissions.has("videos:assign")
      ? db.select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(and(eq(users.primaryRole, "editor"), eq(users.status, "active"), isNull(users.deletedAt)))
          .orderBy(asc(users.fullName))
      : Promise.resolve([]),
  ]);

  const comments = threads.length
    ? await db
        .select({
          id: reviewComments.id,
          threadId: reviewComments.threadId,
          body: reviewComments.body,
          authorName: reviewComments.authorName,
          timecodeMs: reviewComments.timecodeMs,
          source: reviewComments.source,
          createdAt: reviewComments.createdAt,
        })
        .from(reviewComments)
        .where(
          and(
            inArray(reviewComments.threadId, threads.map((t) => t.id)),
            isNull(reviewComments.deletedAt),
          ),
        )
        .orderBy(asc(reviewComments.createdAt))
    : [];

  return {
    video,
    versions,
    threads: threads.map((t) => ({
      ...t,
      comments: comments.filter((c) => c.threadId === t.id),
    })),
    approvals: approvalRows,
    editorOptions: editorList,
    canSeeInternal,
  };
}

export type VideoDetail = Awaited<ReturnType<typeof getVideo>>;

/** Aantallen per pipelinestap, voor de kanban-kolomkoppen. */
export async function pipelineCounts(viewer: Viewer) {
  const rows = await db
    .select({ status: deliverables.status, total: sql<number>`count(*)` })
    .from(deliverables)
    .where(and(isNull(deliverables.deletedAt), scopeToClients(viewer, deliverables.clientId)))
    .groupBy(deliverables.status);
  return new Map(rows.map((r) => [r.status, Number(r.total)]));
}
