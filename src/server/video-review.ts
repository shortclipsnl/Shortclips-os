import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, frameAssets, portalVideoApprovals, portalVideoComments } from "@/db/schema";
import { videoReviewState, type ReviewState, type SessionKey, type VideoReviewKey } from "@/lib/video-review";

/**
 * Leeslaag voor de videobeoordeling: per video de status, de versie en de
 * opmerkingen die de klant mag zien. Concepten zijn alleen zichtbaar voor de
 * klant zelf (zelfde klantomgeving); teamreacties alleen als ze aan een
 * klantopmerking gekoppeld zijn.
 */

export type ReviewComment = {
  id: string;
  parentId: string | null;
  timecodeMs: number | null;
  body: string;
  authorName: string | null;
  authorKind: "client" | "shortclips";
  status: "draft" | "submitted";
  createdAt: string;
  submittedAt: string | null;
  completed: boolean;
  /** Is de opmerking in Frame.io terechtgekomen? (alleen voor verstuurde) */
  synced: boolean;
  versionNumber: number;
  mediaFileId: string;
};

export type VideoReview = {
  assetId: string;
  mediaFileId: string;
  versionNumber: number;
  state: ReviewState;
  label: VideoReviewKey | null;
  approvedAt: string | null;
  approvedBy: string | null;
  /** Opmerkingen op de huidige versie (incl. concepten en reacties). */
  comments: ReviewComment[];
  /** Opmerkingen op eerdere versies, alleen ter naslag. */
  previous: ReviewComment[];
  draftCount: number;
  /** Aantal verstuurde klantopmerkingen op de huidige versie. */
  feedbackCount: number;
  hasNewVersion: boolean;
};

type AssetRow = { id: string; mediaFileId: string; versionCount: number };

/** Het editingproject van een opnamedag (zelfde keuze als de videopagina). */
export async function deliverableForDay(clientId: string, dayId: string | null): Promise<{ id: string; status: string; editorId: string | null; title: string } | null> {
  if (!dayId) return null;
  const rows = await db
    .select({ id: deliverables.id, status: deliverables.status, editorId: deliverables.editorId, title: deliverables.title })
    .from(deliverables)
    .where(and(eq(deliverables.clientId, clientId), eq(deliverables.productionDayId, dayId), isNull(deliverables.deletedAt)));
  if (!rows.length) return null;
  const RANK = ["client_review", "client_revision", "editing", "internal_review", "editor_revision", "awaiting_editor", "footage_upload", "recorded", "approved", "ready_to_publish", "scheduled", "published", "analysis_available"];
  return rows.sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))[0]!;
}

export async function loadVideoReviews(
  clientId: string,
  assets: AssetRow[],
  session: { key: SessionKey; deliverableStatus: string | null },
): Promise<Map<string, VideoReview>> {
  const out = new Map<string, VideoReview>();
  if (!assets.length) return out;
  const ids = assets.map((a) => a.id);
  const [comments, approvals] = await Promise.all([
    db
      .select({
        id: portalVideoComments.id,
        assetId: portalVideoComments.frameAssetId,
        parentId: portalVideoComments.parentId,
        timecodeMs: portalVideoComments.timecodeMs,
        body: portalVideoComments.body,
        authorName: portalVideoComments.authorName,
        authorKind: portalVideoComments.authorKind,
        status: portalVideoComments.status,
        createdAt: portalVideoComments.createdAt,
        submittedAt: portalVideoComments.submittedAt,
        completedAt: portalVideoComments.completedAt,
        syncStatus: portalVideoComments.syncStatus,
        versionNumber: portalVideoComments.versionNumber,
        mediaFileId: portalVideoComments.mediaFileId,
      })
      .from(portalVideoComments)
      .where(and(eq(portalVideoComments.clientId, clientId), inArray(portalVideoComments.frameAssetId, ids), isNull(portalVideoComments.deletedAt)))
      .orderBy(asc(portalVideoComments.timecodeMs), asc(portalVideoComments.createdAt)),
    db
      .select({ assetId: portalVideoApprovals.frameAssetId, mediaFileId: portalVideoApprovals.mediaFileId, at: portalVideoApprovals.approvedAt, by: portalVideoApprovals.approvedByName })
      .from(portalVideoApprovals)
      .where(and(eq(portalVideoApprovals.clientId, clientId), inArray(portalVideoApprovals.frameAssetId, ids))),
  ]);

  for (const a of assets) {
    const mine = comments.filter((c) => c.assetId === a.id);
    const appr = approvals.filter((x) => x.assetId === a.id);
    const submittedClient = mine.filter((c) => c.status === "submitted" && c.authorKind === "client");
    const state = videoReviewState({
      session: session.key,
      deliverableStatus: session.deliverableStatus,
      currentMediaFileId: a.mediaFileId,
      approvedMediaFileIds: appr.map((x) => x.mediaFileId),
      submitted: submittedClient.map((c) => ({ mediaFileId: c.mediaFileId, completed: !!c.completedAt })),
    });
    const map = (c: (typeof mine)[number]): ReviewComment => ({
      id: c.id,
      parentId: c.parentId,
      timecodeMs: c.timecodeMs,
      body: c.body,
      authorName: c.authorName,
      authorKind: c.authorKind === "shortclips" ? "shortclips" : "client",
      status: c.status === "draft" ? "draft" : "submitted",
      createdAt: c.createdAt.toISOString(),
      submittedAt: c.submittedAt?.toISOString() ?? null,
      completed: !!c.completedAt,
      synced: c.syncStatus === "synced",
      versionNumber: c.versionNumber,
      mediaFileId: c.mediaFileId,
    });
    const current = mine.filter((c) => c.mediaFileId === a.mediaFileId).map(map);
    const previous = mine.filter((c) => c.mediaFileId !== a.mediaFileId && c.status === "submitted").map(map);
    const approvedNow = appr.find((x) => x.mediaFileId === a.mediaFileId);
    out.set(a.id, {
      assetId: a.id,
      mediaFileId: a.mediaFileId,
      versionNumber: a.versionCount,
      state,
      label: state.key,
      approvedAt: approvedNow?.at.toISOString() ?? null,
      approvedBy: approvedNow?.by ?? null,
      comments: current,
      previous,
      draftCount: current.filter((c) => c.status === "draft").length,
      feedbackCount: current.filter((c) => c.status === "submitted" && c.authorKind === "client").length,
      hasNewVersion: previous.length > 0 && state.key === "opnieuw_beoordelen",
    });
  }
  return out;
}

/** Context van één video voor een klantactie, strikt binnen de eigen klant. */
export async function assetForClient(clientId: string, assetId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  const [a] = await db
    .select({
      id: frameAssets.id,
      clientId: frameAssets.clientId,
      name: frameAssets.name,
      mediaFileId: frameAssets.mediaFileId,
      versionCount: frameAssets.versionCount,
      projectId: frameAssets.frameProjectId,
      sessionFolderId: frameAssets.sessionFolderId,
      sessionName: frameAssets.sessionName,
      dayId: frameAssets.sessionProductionDayId,
      viewUrl: frameAssets.viewUrl,
    })
    .from(frameAssets)
    .where(and(eq(frameAssets.id, assetId), eq(frameAssets.clientId, clientId), isNull(frameAssets.deletedAt)))
    .limit(1);
  return a ?? null;
}
