import "server-only";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approvals, deliverables, reviewComments, reviewThreads } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { dispatch } from "@/server/automation";
import { syncContentForDeliverable } from "@/server/content-sync";
import { syncFeedbackRounds } from "@/server/feedback-rounds";
import { notifyXpEarned, recordAwardsSafe } from "@/server/awards/service";

/**
 * Statusovergangen van een editingproject (deliverable) door de klant. Eén
 * plek, gebruikt door zowel de oude knoppen per sessie als de nieuwe
 * videobeoordeling per video. Zo lopen feedbackrondes, takenpagina,
 * contentplanning, awards en automatiseringen altijd op dezelfde manier mee.
 */

export type TransitionResult = { ok: boolean; message?: string };

export async function clientApproveDeliverable(viewer: Viewer, videoId: string): Promise<TransitionResult> {
  const [video] = await db
    .select({ id: deliverables.id, clientId: deliverables.clientId, title: deliverables.title, status: deliverables.status, editorId: deliverables.editorId })
    .from(deliverables)
    .where(and(eq(deliverables.id, videoId), eq(deliverables.clientId, viewer.clientId!)))
    .limit(1);

  if (!video) return { ok: false, message: "Deze video is niet gevonden." };
  if (!["client_review", "client_revision"].includes(video.status)) {
    return { ok: false, message: "Deze video staat niet klaar voor goedkeuring." };
  }

  await db
    .update(deliverables)
    .set({ status: "approved", statusChangedAt: new Date(), approvedAt: new Date() })
    .where(eq(deliverables.id, videoId));
  // Klant heeft gereageerd: feedbackronde stopt, herinneringstaak vervalt.
  await syncFeedbackRounds([videoId]).catch((e) => console.error("[feedback-rounds]", e));

  // Showcase: awards van de editor bijwerken (nooit blokkerend).
  await recordAwardsSafe(video.editorId);
  await notifyXpEarned(video.editorId, videoId);

  await db
    .update(approvals)
    .set({ status: "approved", decidedAt: new Date(), decidedByUserId: viewer.id })
    .where(and(eq(approvals.entityId, videoId), eq(approvals.status, "pending")));

  await auditLog({ viewer, action: "portal.video_approved", entityType: "deliverable", entityId: videoId, clientId: video.clientId });
  await recordActivity({
    clientId: video.clientId,
    type: "video.approved_by_client",
    title: `Video goedgekeurd door de klant: ${video.title}`,
    entityType: "deliverable",
    entityId: videoId,
    actor: { id: viewer.id, fullName: viewer.fullName },
    isClientVisible: true,
  });
  await dispatch({
    trigger: "video.status_changed",
    clientId: video.clientId,
    entityType: "deliverable",
    entityId: videoId,
    data: { from: video.status, to: "approved", title: video.title },
  });
  // Direct als gekoppeld record in de contentplanning zetten.
  await syncContentForDeliverable(videoId);

  revalidatePath("/portal");
  revalidatePath(`/portal/videos/${videoId}`);
  revalidatePath("/calendar");
  return { ok: true, message: "Bedankt. De video staat op goedgekeurd." };
}

/**
 * Klant vraagt aanpassingen. `threads` maakt het mogelijk de feedback per
 * tijdcode vast te leggen (videobeoordeling); zonder threads geldt de oude
 * vorm met één algemene opmerking.
 */
export async function clientRequestChangesDeliverable(
  viewer: Viewer,
  videoId: string,
  input: { summary: string; threads?: Array<{ body: string; timecodeMs: number | null; frameCommentId?: string | null }> },
): Promise<TransitionResult> {
  const [video] = await db
    .select({ id: deliverables.id, clientId: deliverables.clientId, title: deliverables.title, status: deliverables.status, clientRevisionRounds: deliverables.clientRevisionRounds })
    .from(deliverables)
    .where(and(eq(deliverables.id, videoId), eq(deliverables.clientId, viewer.clientId!)))
    .limit(1);

  if (!video) return { ok: false, message: "Deze video is niet gevonden." };

  const threads = input.threads?.length ? input.threads : [{ body: input.summary, timecodeMs: null, frameCommentId: null }];
  for (const t of threads) {
    const [thread] = await db
      .insert(reviewThreads)
      .values({ deliverableId: videoId, visibility: "client", timecodeMs: t.timecodeMs, frameCommentId: t.frameCommentId ?? null })
      .returning({ id: reviewThreads.id });
    await db.insert(reviewComments).values({
      threadId: thread!.id,
      body: t.body,
      authorUserId: viewer.id,
      authorName: viewer.fullName,
      source: "portal",
      timecodeMs: t.timecodeMs,
    });
  }

  // Alleen een nieuwe ronde starten als de klant aan zet was. Staat het project
  // al op "feedback verwerken", dan is dit een aanvulling binnen dezelfde ronde.
  if (video.status !== "client_revision") {
    await db
      .update(deliverables)
      .set({
        status: "client_revision",
        statusChangedAt: new Date(),
        clientRevisionRounds: video.clientRevisionRounds + 1,
      })
      .where(eq(deliverables.id, videoId));
  }
  // Klant heeft feedback gegeven: feedbackronde stopt, herinneringstaak vervalt.
  await syncFeedbackRounds([videoId]).catch((e) => console.error("[feedback-rounds]", e));

  await db
    .update(approvals)
    .set({ status: "changes_requested", decidedAt: new Date(), decidedByUserId: viewer.id, comment: input.summary })
    .where(and(eq(approvals.entityId, videoId), eq(approvals.status, "pending")));

  await recordActivity({
    clientId: video.clientId,
    type: "video.changes_requested",
    title: `Klant vroeg om aanpassingen: ${video.title}`,
    body: input.summary,
    entityType: "deliverable",
    entityId: videoId,
    actor: { id: viewer.id, fullName: viewer.fullName },
    isClientVisible: true,
  });
  if (video.status !== "client_revision") {
    await dispatch({
      trigger: "video.status_changed",
      clientId: video.clientId,
      entityType: "deliverable",
      entityId: videoId,
      data: { to: "client_revision", title: video.title, href: `/videos/${videoId}` },
    });
  }

  revalidatePath("/portal");
  revalidatePath(`/portal/videos/${videoId}`);
  return { ok: true, message: "Je feedback is doorgestuurd naar het team." };
}
