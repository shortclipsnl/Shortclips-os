"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { approvals, deliverables, reviewComments, reviewThreads, scripts } from "@/db/schema";
import { ForbiddenError, requirePortal } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { dispatch } from "@/server/automation";
import { syncContentForDeliverable } from "@/server/content-sync";
import { recordAwardsSafe } from "@/server/awards/service";

export type ActionResult = { ok: boolean; message?: string };

const feedbackSchema = z.object({
  body: z.string().trim().min(1, "Schrijf eerst je feedback.").max(4000),
});

/**
 * Klantacties. Alles wordt hier opnieuw gecontroleerd op de klant van de
 * ingelogde gebruiker: een video-id uit een andere omgeving levert niets op.
 */
export async function approveVideo(videoId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();

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

    // Showcase: awards van de editor bijwerken (nooit blokkerend).
    await recordAwardsSafe(video.editorId);

    await db
      .update(approvals)
      .set({ status: "approved", decidedAt: new Date(), decidedByUserId: viewer.id })
      .where(and(eq(approvals.entityId, videoId), eq(approvals.status, "pending")));

    await auditLog({
      viewer,
      action: "portal.video_approved",
      entityType: "deliverable",
      entityId: videoId,
      clientId: video.clientId,
    });
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
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function requestChanges(
  videoId: string,
  input: { body: string },
): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };

    const [video] = await db
      .select({ id: deliverables.id, clientId: deliverables.clientId, title: deliverables.title, clientRevisionRounds: deliverables.clientRevisionRounds })
      .from(deliverables)
      .where(and(eq(deliverables.id, videoId), eq(deliverables.clientId, viewer.clientId!)))
      .limit(1);

    if (!video) return { ok: false, message: "Deze video is niet gevonden." };

    const [thread] = await db
      .insert(reviewThreads)
      .values({ deliverableId: videoId, visibility: "client" })
      .returning({ id: reviewThreads.id });

    await db.insert(reviewComments).values({
      threadId: thread!.id,
      body: parsed.data.body,
      authorUserId: viewer.id,
      authorName: viewer.fullName,
      source: "portal",
    });

    await db
      .update(deliverables)
      .set({
        status: "client_revision",
        statusChangedAt: new Date(),
        clientRevisionRounds: video.clientRevisionRounds + 1,
      })
      .where(eq(deliverables.id, videoId));

    await db
      .update(approvals)
      .set({ status: "changes_requested", decidedAt: new Date(), decidedByUserId: viewer.id, comment: parsed.data.body })
      .where(and(eq(approvals.entityId, videoId), eq(approvals.status, "pending")));

    await recordActivity({
      clientId: video.clientId,
      type: "video.changes_requested",
      title: `Klant vroeg om aanpassingen: ${video.title}`,
      body: parsed.data.body,
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
      data: { to: "client_revision", title: video.title, href: `/videos/${videoId}` },
    });

    revalidatePath("/portal");
    revalidatePath(`/portal/videos/${videoId}`);
    return { ok: true, message: "Je feedback is doorgestuurd naar het team." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function approveScript(scriptId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();

    const [script] = await db
      .select({ id: scripts.id, clientId: scripts.clientId, title: scripts.title })
      .from(scripts)
      .where(
        and(
          eq(scripts.id, scriptId),
          eq(scripts.clientId, viewer.clientId!),
          eq(scripts.status, "client_review"),
        ),
      )
      .limit(1);

    if (!script) return { ok: false, message: "Dit script staat niet klaar voor goedkeuring." };

    await db
      .update(scripts)
      .set({ status: "approved", approvedAt: new Date(), approvedById: viewer.id, updatedAt: new Date() })
      .where(eq(scripts.id, scriptId));

    await recordActivity({
      clientId: script.clientId,
      type: "script.approved_by_client",
      title: `Script goedgekeurd door de klant: ${script.title}`,
      entityType: "script",
      entityId: scriptId,
      actor: { id: viewer.id, fullName: viewer.fullName },
      isClientVisible: true,
    });

    // Automatiseringen aftrappen (bijv. opnamedag inplannen).
    await dispatch({
      trigger: "script.status_changed",
      clientId: script.clientId,
      entityType: "script",
      entityId: scriptId,
      data: { from: "client_review", to: "approved", actorId: viewer.id },
    });

    revalidatePath("/portal");
    return { ok: true, message: "Script goedgekeurd." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function commentOnScript(
  scriptId: string,
  input: { body: string },
): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };

    const [script] = await db
      .select({ id: scripts.id, clientId: scripts.clientId, title: scripts.title, clientNotes: scripts.clientNotes })
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.clientId, viewer.clientId!)))
      .limit(1);

    if (!script) return { ok: false, message: "Dit script is niet gevonden." };

    const stamp = new Date().toLocaleDateString("nl-NL");
    await db
      .update(scripts)
      .set({
        status: "revising",
        clientNotes: `${script.clientNotes ? `${script.clientNotes}\n\n` : ""}[${stamp} — ${viewer.fullName}] ${parsed.data.body}`,
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, scriptId));

    await recordActivity({
      clientId: script.clientId,
      type: "script.feedback_received",
      title: `Feedback op script: ${script.title}`,
      body: parsed.data.body,
      entityType: "script",
      entityId: scriptId,
      actor: { id: viewer.id, fullName: viewer.fullName },
      isClientVisible: true,
    });

    // Automatiseringen aftrappen (team informeren + feedback verwerken).
    await dispatch({
      trigger: "script.status_changed",
      clientId: script.clientId,
      entityType: "script",
      entityId: scriptId,
      data: { from: "client_review", to: "revising", actorId: viewer.id },
    });

    revalidatePath("/portal");
    return { ok: true, message: "Je opmerking is doorgestuurd." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
