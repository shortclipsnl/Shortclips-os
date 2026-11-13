"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, frameAssets, portalFeedbackSubmissions, portalVideoApprovals, portalVideoComments } from "@/db/schema";
import { ForbiddenError, requirePortal, type Viewer } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { sessionStatusFor, prettySessionName } from "@/server/portal-frame";
import { assetForClient, deliverableForDay, loadVideoReviews } from "@/server/video-review";
import { clientApproveDeliverable, clientRequestChangesDeliverable } from "@/server/portal-video-transitions";
import { pushCommentToFrame, setFrameStatus } from "@/server/video-review-sync";
import { frameio } from "@/server/integrations/frameio";
import { cleanVideoTitle } from "@/lib/portal-status";
import { formatTimecode } from "@/lib/video-review";

/**
 * Klantacties van de videobeoordeling. Elke actie controleert opnieuw dat de
 * video bij de klant van de ingelogde gebruiker hoort: een id uit een andere
 * klantomgeving levert niets op. Frame.io-gegevens verlaten de server nooit.
 */

export type ReviewActionResult = { ok: boolean; message?: string; id?: string };

const bodySchema = z.string().trim().min(1, "Schrijf eerst je opmerking.").max(3000, "Je opmerking is te lang (max. 3000 tekens).");

async function portalViewer(): Promise<Viewer> {
  const viewer = await requirePortal();
  if (!viewer.clientId) throw new ForbiddenError("Geen klantomgeving.");
  return viewer;
}

/** Video + sessiecontext + huidige beoordelingsstatus. */
async function reviewContext(viewer: Viewer, assetId: string) {
  const asset = await assetForClient(viewer.clientId!, assetId);
  if (!asset) return null;
  const deliverable = await deliverableForDay(viewer.clientId!, asset.dayId);
  const sessionKey = sessionStatusFor(deliverable?.status ?? null, null, true)?.key ?? null;
  const reviews = await loadVideoReviews(viewer.clientId!, [{ id: asset.id, mediaFileId: asset.mediaFileId, versionCount: asset.versionCount }], {
    key: sessionKey,
    deliverableStatus: deliverable?.status ?? null,
  });
  return { asset, deliverable, sessionKey, review: reviews.get(asset.id)! };
}

function fail(error: unknown): ReviewActionResult {
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  console.error("[video-review]", error);
  return { ok: false, message: "Er ging iets mis. Probeer het opnieuw." };
}

function revalidateVideos() {
  revalidatePath("/portal/videos");
  revalidatePath("/portal");
}

/* ---------------- Opmerkingen (concept) ---------------- */

export async function addVideoComment(input: { assetId: string; timecodeMs: number | null; body: string }): Promise<ReviewActionResult> {
  try {
    const viewer = await portalViewer();
    const body = bodySchema.safeParse(input.body);
    if (!body.success) return { ok: false, message: body.error.issues[0]?.message };
    const ctx = await reviewContext(viewer, input.assetId);
    if (!ctx) return { ok: false, message: "Deze video is niet gevonden." };
    if (!ctx.review.state.canReview) return { ok: false, message: "Deze video staat nu niet open voor feedback." };
    const tc = input.timecodeMs == null ? null : Math.max(0, Math.min(Math.round(input.timecodeMs), 6 * 3_600_000));
    const [row] = await db
      .insert(portalVideoComments)
      .values({
        clientId: viewer.clientId!,
        frameAssetId: ctx.asset.id,
        mediaFileId: ctx.asset.mediaFileId,
        versionNumber: ctx.asset.versionCount,
        timecodeMs: tc,
        body: body.data,
        authorUserId: viewer.id,
        authorName: viewer.fullName,
        authorKind: "client",
        source: "portal",
        status: "draft",
      })
      .returning({ id: portalVideoComments.id });
    revalidateVideos();
    return { ok: true, id: row!.id };
  } catch (e) {
    return fail(e);
  }
}

async function ownDraft(viewer: Viewer, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [c] = await db
    .select({ id: portalVideoComments.id, status: portalVideoComments.status })
    .from(portalVideoComments)
    .where(and(eq(portalVideoComments.id, id), eq(portalVideoComments.clientId, viewer.clientId!), isNull(portalVideoComments.deletedAt)))
    .limit(1);
  return c && c.status === "draft" ? c : null;
}

export async function updateVideoComment(id: string, text: string): Promise<ReviewActionResult> {
  try {
    const viewer = await portalViewer();
    const body = bodySchema.safeParse(text);
    if (!body.success) return { ok: false, message: body.error.issues[0]?.message };
    if (!(await ownDraft(viewer, id))) return { ok: false, message: "Alleen niet-verstuurde opmerkingen kun je aanpassen." };
    await db.update(portalVideoComments).set({ body: body.data, updatedAt: new Date() }).where(eq(portalVideoComments.id, id));
    revalidateVideos();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteVideoComment(id: string): Promise<ReviewActionResult> {
  try {
    const viewer = await portalViewer();
    if (!(await ownDraft(viewer, id))) return { ok: false, message: "Alleen niet-verstuurde opmerkingen kun je verwijderen." };
    await db.update(portalVideoComments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(portalVideoComments.id, id));
    revalidateVideos();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ---------------- Reageren op een opmerking ---------------- */

export async function replyToVideoComment(parentId: string, text: string): Promise<ReviewActionResult> {
  try {
    const viewer = await portalViewer();
    const body = bodySchema.safeParse(text);
    if (!body.success) return { ok: false, message: body.error.issues[0]?.message };
    if (!/^[0-9a-f-]{36}$/i.test(parentId)) return { ok: false, message: "Opmerking niet gevonden." };
    const [p] = await db
      .select({
        id: portalVideoComments.id,
        assetId: portalVideoComments.frameAssetId,
        mediaFileId: portalVideoComments.mediaFileId,
        versionNumber: portalVideoComments.versionNumber,
        timecodeMs: portalVideoComments.timecodeMs,
        status: portalVideoComments.status,
        parentId: portalVideoComments.parentId,
      })
      .from(portalVideoComments)
      .where(and(eq(portalVideoComments.id, parentId), eq(portalVideoComments.clientId, viewer.clientId!), isNull(portalVideoComments.deletedAt)))
      .limit(1);
    if (!p || p.status !== "submitted") return { ok: false, message: "Je kunt alleen reageren op verstuurde opmerkingen." };
    const now = new Date();
    const [row] = await db
      .insert(portalVideoComments)
      .values({
        clientId: viewer.clientId!,
        frameAssetId: p.assetId,
        mediaFileId: p.mediaFileId,
        versionNumber: p.versionNumber,
        timecodeMs: p.timecodeMs,
        body: body.data,
        parentId: p.parentId ?? p.id,
        authorUserId: viewer.id,
        authorName: viewer.fullName,
        authorKind: "client",
        source: "portal",
        status: "submitted",
        submittedAt: now,
        syncStatus: "pending",
      })
      .returning({ id: portalVideoComments.id });
    await pushCommentToFrame(row!.id);
    revalidateVideos();
    return { ok: true, id: row!.id, message: "Je reactie is doorgestuurd." };
  } catch (e) {
    return fail(e);
  }
}

/* ---------------- Feedback versturen (gebundeld per sessie) ---------------- */

export async function submitSessionFeedback(sessionKey: string): Promise<ReviewActionResult> {
  try {
    const viewer = await portalViewer();
    const clientId = viewer.clientId!;
    const assets = await db
      .select({
        id: frameAssets.id,
        name: frameAssets.name,
        mediaFileId: frameAssets.mediaFileId,
        projectId: frameAssets.frameProjectId,
        sessionName: frameAssets.sessionName,
        dayId: frameAssets.sessionProductionDayId,
        viewUrl: frameAssets.viewUrl,
        subfolder: frameAssets.subfolderName,
      })
      .from(frameAssets)
      .where(
        and(
          eq(frameAssets.clientId, clientId),
          isNull(frameAssets.deletedAt),
          sessionKey === "los" ? isNull(frameAssets.sessionFolderId) : eq(frameAssets.sessionFolderId, sessionKey),
        ),
      )
      .orderBy(asc(frameAssets.name));
    if (!assets.length) return { ok: false, message: "Deze opnamesessie is niet gevonden." };
    // Zelfde volgorde als in het portaal: eerst zonder submap, dan per submap.
    assets.sort((a, b) => (a.subfolder === b.subfolder ? 0 : a.subfolder === null ? -1 : b.subfolder === null ? 1 : a.subfolder.localeCompare(b.subfolder, "nl")));
    const byId = new Map(assets.map((a) => [a.id, a]));

    const drafts = await db
      .select({ id: portalVideoComments.id, assetId: portalVideoComments.frameAssetId, mediaFileId: portalVideoComments.mediaFileId, body: portalVideoComments.body, timecodeMs: portalVideoComments.timecodeMs })
      .from(portalVideoComments)
      .where(
        and(
          eq(portalVideoComments.clientId, clientId),
          inArray(portalVideoComments.frameAssetId, assets.map((a) => a.id)),
          eq(portalVideoComments.status, "draft"),
          isNull(portalVideoComments.deletedAt),
        ),
      );
    // Alleen concepten op de huidige versie tellen; een concept op een
    // inmiddels vervangen versie wordt niet ongemerkt bij de nieuwe gezet.
    const valid = drafts.filter((d) => byId.get(d.assetId)?.mediaFileId === d.mediaFileId);
    const stale = drafts.filter((d) => !valid.includes(d));
    if (stale.length) {
      await db.update(portalVideoComments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(portalVideoComments.id, stale.map((s) => s.id)));
    }
    if (!valid.length) {
      return { ok: false, message: stale.length ? "Er staat inmiddels een nieuwe versie klaar. Bekijk die en plaats je opmerkingen opnieuw." : "Er zijn geen opmerkingen om te versturen." };
    }

    const [client] = await db.select({ name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    const dayId = assets.find((a) => a.dayId)?.dayId ?? null;
    const deliverable = await deliverableForDay(clientId, dayId);
    const sessionTitle = prettySessionName(assets[0]!.sessionName);
    const now = new Date();
    const submissionId = randomUUID();

    await db
      .update(portalVideoComments)
      .set({ status: "submitted", submittedAt: now, submissionId, syncStatus: "pending", updatedAt: now })
      .where(inArray(portalVideoComments.id, valid.map((v) => v.id)));

    const videoIds = [...new Set(valid.map((v) => v.assetId))];
    await db.insert(portalFeedbackSubmissions).values({
      id: submissionId,
      clientId,
      sessionFolderId: sessionKey === "los" ? null : sessionKey,
      sessionName: assets[0]!.sessionName,
      deliverableId: deliverable?.id ?? null,
      commentCount: valid.length,
      videoCount: videoIds.length,
      submittedByUserId: viewer.id,
      submittedByName: viewer.fullName,
    });

    // Naar Frame.io: elke opmerking op de juiste versie en tijdcode. Mislukt er
    // één, dan probeert de achtergrondjob het opnieuw; de klant merkt daar niets van.
    let synced = 0;
    for (const v of valid) {
      const r = await pushCommentToFrame(v.id);
      if (r.ok) synced++;
    }
    const byProject = new Map<string, string[]>();
    for (const id of videoIds) {
      const a = byId.get(id)!;
      byProject.set(a.projectId, [...(byProject.get(a.projectId) ?? []), a.mediaFileId]);
    }
    for (const [projectId, files] of byProject) await setFrameStatus(projectId, files, "In Progress");

    // Editingproject: bestaande workflow (feedbackronde, takenpagina, automatiseringen).
    const titleOf = (id: string) => cleanVideoTitle(byId.get(id)?.name) || byId.get(id)?.name || "Video";
    const order = assets.map((a) => a.id);
    const videoNo = (id: string) => order.indexOf(id) + 1;
    const summary = videoIds
      .map((id) => `${titleOf(id)}: ${valid.filter((v) => v.assetId === id).length} opmerking(en)`)
      .join("\n");
    if (deliverable && ["client_review", "client_revision"].includes(deliverable.status)) {
      await clientRequestChangesDeliverable(viewer, deliverable.id, {
        summary,
        threads: valid.map((v) => ({
          body: `Video ${videoNo(v.assetId)} · ${titleOf(v.assetId)}${v.timecodeMs != null ? ` · ${formatTimecode(v.timecodeMs)}` : ""}\n${v.body}`,
          timecodeMs: v.timecodeMs,
        })),
      });
    }

    // Eén melding per verzending, niet per opmerking.
    const videoLabel = videoIds.length === 1 ? `video ${videoNo(videoIds[0]!)}` : `${videoIds.length} video's`;
    const recipients = [deliverable?.editorId, client?.coordinatorId].filter((x): x is string => !!x);
    const href = deliverable ? `/videos/${deliverable.id}` : client ? `/clients/${client.slug}/videos?sessie=${encodeURIComponent(sessionKey)}` : "/videos";
    const title = `Nieuwe feedback ontvangen van ${client?.name ?? "een klant"}`;
    const body = `Er ${valid.length === 1 ? "staat 1 opmerking" : `staan ${valid.length} opmerkingen`} klaar bij ${videoLabel} van ${sessionTitle.toLowerCase().startsWith("sessie") ? sessionTitle.charAt(0).toLowerCase() + sessionTitle.slice(1) : `sessie ${sessionTitle}`}. Bekijk de feedback.`;
    await notify({
      userIds: recipients.length ? recipients : undefined,
      roles: recipients.length ? undefined : ["owner"],
      clientId,
      type: "portal.video_feedback",
      level: "warning",
      title,
      body,
      href,
      entityType: deliverable ? "deliverable" : "client",
      entityId: deliverable?.id ?? clientId,
      dedupeKey: `portal.video_feedback:${submissionId}`,
    });
    await db.update(portalFeedbackSubmissions).set({ notifiedAt: new Date() }).where(eq(portalFeedbackSubmissions.id, submissionId));

    await auditLog({ viewer, action: "portal.video_feedback_submitted", entityType: "client", entityId: clientId, clientId, changes: { comments: valid.length, videos: videoIds.length, synced } });
    await recordActivity({
      clientId,
      type: "video.feedback_submitted",
      title: `Feedback verstuurd op ${videoLabel} van ${sessionTitle}`,
      body: summary,
      entityType: deliverable ? "deliverable" : "client",
      entityId: deliverable?.id ?? clientId,
      actor: { id: viewer.id, fullName: viewer.fullName },
      isClientVisible: true,
    });

    revalidateVideos();
    return {
      ok: true,
      message: `Bedankt. ${valid.length === 1 ? "Je opmerking is" : `Je ${valid.length} opmerkingen zijn`} verstuurd naar het team.`,
    };
  } catch (e) {
    return fail(e);
  }
}

/* ---------------- Goedkeuren ---------------- */

async function approveAssets(viewer: Viewer, assetIds: string[]): Promise<{ approved: string[]; sessionFolderId: string | null; dayId: string | null }> {
  const clientId = viewer.clientId!;
  const approved: string[] = [];
  let sessionFolderId: string | null = null;
  let dayId: string | null = null;
  const byProject = new Map<string, string[]>();
  for (const id of assetIds) {
    const ctx = await reviewContext(viewer, id);
    if (!ctx || !ctx.review.state.canReview) continue;
    sessionFolderId = ctx.asset.sessionFolderId;
    dayId = ctx.asset.dayId;
    // Niet verstuurde opmerkingen op deze versie vervallen bij goedkeuring.
    await db
      .update(portalVideoComments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(portalVideoComments.frameAssetId, id), eq(portalVideoComments.status, "draft"), isNull(portalVideoComments.deletedAt)));
    const ins = await db
      .insert(portalVideoApprovals)
      .values({
        clientId,
        frameAssetId: id,
        mediaFileId: ctx.asset.mediaFileId,
        versionNumber: ctx.asset.versionCount,
        approvedByUserId: viewer.id,
        approvedByName: viewer.fullName,
      })
      .onConflictDoNothing()
      .returning({ id: portalVideoApprovals.id });
    if (!ins.length) continue;
    approved.push(id);
    byProject.set(ctx.asset.projectId, [...(byProject.get(ctx.asset.projectId) ?? []), ctx.asset.mediaFileId]);
    // Zichtbaar in Frame.io: korte opmerking (niet bij een hele sessie tegelijk).
    if (assetIds.length === 1 && frameio.isConfigured) {
      const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
      await frameio
        .createComment(ctx.asset.mediaFileId, { text: `Goedgekeurd door ${viewer.fullName} (${client?.name ?? "klant"}) via het Shortclips portaal.` })
        .catch(() => undefined);
    }
  }
  for (const [projectId, files] of byProject) {
    const err = await setFrameStatus(projectId, files, "Approved");
    await db
      .update(portalVideoApprovals)
      .set(err ? { frameSyncError: err, updatedAt: new Date() } : { frameSyncedAt: new Date(), frameSyncError: null, updatedAt: new Date() })
      .where(and(eq(portalVideoApprovals.clientId, clientId), inArray(portalVideoApprovals.mediaFileId, files)));
  }
  return { approved, sessionFolderId, dayId };
}

/** Als alle video's van de sessie goedgekeurd zijn: editingproject ook op goedgekeurd. */
async function completeSessionIfDone(viewer: Viewer, sessionFolderId: string | null, dayId: string | null): Promise<boolean> {
  const clientId = viewer.clientId!;
  const deliverable = await deliverableForDay(clientId, dayId);
  if (!deliverable || !["client_review", "client_revision"].includes(deliverable.status)) return false;
  const assets = await db
    .select({ id: frameAssets.id, mediaFileId: frameAssets.mediaFileId, versionCount: frameAssets.versionCount })
    .from(frameAssets)
    .where(and(eq(frameAssets.clientId, clientId), isNull(frameAssets.deletedAt), sessionFolderId ? eq(frameAssets.sessionFolderId, sessionFolderId) : isNull(frameAssets.sessionFolderId)));
  const reviews = await loadVideoReviews(clientId, assets, { key: sessionStatusFor(deliverable.status, null, true)?.key ?? null, deliverableStatus: deliverable.status });
  const allApproved = assets.length > 0 && assets.every((a) => reviews.get(a.id)?.label === "goedgekeurd");
  if (!allApproved) return false;
  const r = await clientApproveDeliverable(viewer, deliverable.id);
  return r.ok;
}

async function notifyApproval(viewer: Viewer, count: number, sessionFolderId: string | null, dayId: string | null, sessionDone: boolean, single?: string) {
  const clientId = viewer.clientId!;
  const [client] = await db.select({ name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  const deliverable = await deliverableForDay(clientId, dayId);
  const [s] = sessionFolderId ? await db.select({ name: frameAssets.sessionName }).from(frameAssets).where(eq(frameAssets.sessionFolderId, sessionFolderId)).limit(1) : [];
  const sessionTitle = prettySessionName(s?.name ?? null);
  const recipients = [client?.coordinatorId, deliverable?.editorId].filter((x): x is string => !!x);
  const day = new Date().toISOString().slice(0, 10);
  await notify({
    userIds: recipients.length ? recipients : undefined,
    roles: recipients.length ? undefined : ["owner"],
    clientId,
    type: "portal.video_approved",
    level: "success",
    title: sessionDone ? `${client?.name ?? "Klant"} heeft alle video's van ${sessionTitle} goedgekeurd` : `${client?.name ?? "Klant"} heeft ${single ? `"${single}"` : `${count} video's`} goedgekeurd`,
    body: sessionDone ? "Het editingproject staat nu op goedgekeurd en gaat door naar de contentplanning." : `Sessie: ${sessionTitle}.`,
    href: deliverable ? `/videos/${deliverable.id}` : client ? `/clients/${client.slug}/videos` : "/videos",
    entityType: deliverable ? "deliverable" : "client",
    entityId: deliverable?.id ?? clientId,
    // Losse goedkeuringen bundelen per sessie per dag; afronding altijd apart.
    dedupeKey: sessionDone ? `portal.video_approved.done:${sessionFolderId ?? "los"}:${deliverable?.id ?? ""}` : `portal.video_approved:${sessionFolderId ?? "los"}:${day}`,
  });
}

export async function approvePortalVideo(assetId: string): Promise<ReviewActionResult> {
  try {
    const viewer = await portalViewer();
    const ctx = await reviewContext(viewer, assetId);
    if (!ctx) return { ok: false, message: "Deze video is niet gevonden." };
    if (ctx.review.label === "goedgekeurd") return { ok: true, message: "Deze video is al goedgekeurd." };
    if (!ctx.review.state.canReview) return { ok: false, message: "Deze video staat nu niet klaar voor goedkeuring." };
    const { approved, sessionFolderId, dayId } = await approveAssets(viewer, [assetId]);
    if (!approved.length) return { ok: true, message: "Deze video is al goedgekeurd." };
    const done = await completeSessionIfDone(viewer, sessionFolderId, dayId);
    await notifyApproval(viewer, 1, sessionFolderId, dayId, done, cleanVideoTitle(ctx.asset.name) || ctx.asset.name);
    await auditLog({ viewer, action: "portal.frame_video_approved", entityType: "frame_asset", entityId: assetId, clientId: viewer.clientId });
    await recordActivity({
      clientId: viewer.clientId,
      type: "video.approved_by_client",
      title: `Video goedgekeurd: ${cleanVideoTitle(ctx.asset.name) || ctx.asset.name}`,
      entityType: "frame_asset",
      entityId: assetId,
      actor: { id: viewer.id, fullName: viewer.fullName },
      isClientVisible: true,
    });
    revalidateVideos();
    return { ok: true, message: done ? "Goedgekeurd. Alle video's van deze sessie zijn nu akkoord." : "Goedgekeurd. Dank je wel." };
  } catch (e) {
    return fail(e);
  }
}

/** "Alles goedkeuren" op sessieniveau: elke openstaande video in één keer. */
export async function approvePortalSession(sessionKey: string): Promise<ReviewActionResult> {
  try {
    const viewer = await portalViewer();
    const rows = await db
      .select({ id: frameAssets.id })
      .from(frameAssets)
      .where(and(eq(frameAssets.clientId, viewer.clientId!), isNull(frameAssets.deletedAt), sessionKey === "los" ? isNull(frameAssets.sessionFolderId) : eq(frameAssets.sessionFolderId, sessionKey)));
    if (!rows.length) return { ok: false, message: "Deze opnamesessie is niet gevonden." };
    const { approved, sessionFolderId, dayId } = await approveAssets(viewer, rows.map((r) => r.id));
    const done = await completeSessionIfDone(viewer, sessionFolderId ?? (sessionKey === "los" ? null : sessionKey), dayId);
    if (!approved.length && !done) return { ok: false, message: "Er staan geen video's klaar om goed te keuren." };
    await notifyApproval(viewer, approved.length, sessionFolderId, dayId, done);
    revalidateVideos();
    return { ok: true, message: "Bedankt. De video's zijn goedgekeurd." };
  } catch (e) {
    return fail(e);
  }
}
