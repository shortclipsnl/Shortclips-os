"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  clients,
  deliverables,
  reviewComments,
  reviewThreads,
} from "@/db/schema";
import {
  assertClientAccess,
  requirePermission,
  requireViewer,
  ForbiddenError,
} from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { dispatch } from "@/server/automation";
import { syncContentForDeliverable } from "@/server/content-sync";
import { VIDEO_STAGES, VIDEO_STATUS, type VideoStage } from "@/lib/statuses";

export type ActionResult = { ok: boolean; message?: string };

async function loadVideo(id: string) {
  const [row] = await db
    .select({
      id: deliverables.id,
      clientId: deliverables.clientId,
      title: deliverables.title,
      status: deliverables.status,
      editorId: deliverables.editorId,
      productionDayId: deliverables.productionDayId,
      internalRevisionRounds: deliverables.internalRevisionRounds,
      clientRevisionRounds: deliverables.clientRevisionRounds,
      coordinatorId: clients.coordinatorId,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .where(eq(deliverables.id, id))
    .limit(1);
  return row;
}

/** Statuswissel: de kern van de pipeline. Zet ook tellers en automatiseringen aan. */
export async function changeVideoStatus(
  videoId: string,
  nextStatus: string,
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    if (!VIDEO_STAGES.includes(nextStatus as VideoStage)) {
      return { ok: false, message: "Onbekende status." };
    }

    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    // Publiceren en goedkeuren vragen om een extra recht.
    if (["approved", "ready_to_publish"].includes(nextStatus) && !viewer.permissions.has("videos:approve")) {
      return { ok: false, message: "Je mag video's niet goedkeuren." };
    }
    if (["scheduled", "published"].includes(nextStatus) && !viewer.permissions.has("videos:publish")) {
      return { ok: false, message: "Je mag video's niet publiceren." };
    }

    const patch: Record<string, unknown> = {
      status: nextStatus as VideoStage,
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    };
    if (nextStatus === "editor_revision") {
      patch.internalRevisionRounds = video.internalRevisionRounds + 1;
    }
    if (nextStatus === "client_revision") {
      patch.clientRevisionRounds = video.clientRevisionRounds + 1;
    }
    if (nextStatus === "approved") patch.approvedAt = new Date();
    if (nextStatus === "published") patch.publishedAt = new Date();

    await db.update(deliverables).set(patch).where(eq(deliverables.id, videoId));

    const label = VIDEO_STATUS[nextStatus as VideoStage]?.label ?? nextStatus;
    await Promise.all([
      auditLog({
        viewer,
        action: "video.status_changed",
        entityType: "deliverable",
        entityId: videoId,
        clientId: video.clientId,
        changes: { van: video.status, naar: nextStatus },
      }),
      recordActivity({
        clientId: video.clientId,
        type: "video.status_changed",
        title: `Video naar ${label}: ${video.title}`,
        entityType: "deliverable",
        entityId: videoId,
        actor: { id: viewer.id, fullName: viewer.fullName },
        isClientVisible: ["client_review", "approved", "published"].includes(nextStatus),
      }),
      dispatch({
        trigger: "video.status_changed",
        clientId: video.clientId,
        entityType: "deliverable",
        entityId: videoId,
        data: {
          from: video.status,
          to: nextStatus,
          title: video.title,
          coordinatorId: video.coordinatorId,
          productionDayId: video.productionDayId,
          actorId: viewer.id,
          href: `/videos/${videoId}`,
        },
      }),
    ]);

    // Koppeling met de contentplanning gelijktrekken (één gekoppeld record).
    await syncContentForDeliverable(videoId);

    revalidatePath(`/videos/${videoId}`);
    revalidatePath("/videos");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return { ok: true, message: `Status gewijzigd naar ${label}.` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function assignEditor(
  videoId: string,
  editorId: string | null,
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:assign");
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    await db
      .update(deliverables)
      .set({
        editorId,
        // Zonder editor kan er niet geëdit worden; terug naar de wachtrij.
        status: editorId ? (video.status === "awaiting_editor" ? "editing" : video.status) : "awaiting_editor",
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliverables.id, videoId));

    await auditLog({
      viewer,
      action: "video.editor_assigned",
      entityType: "deliverable",
      entityId: videoId,
      clientId: video.clientId,
      changes: { van: video.editorId, naar: editorId },
    });
    await recordActivity({
      clientId: video.clientId,
      type: "video.assigned",
      title: editorId ? `Editor toegewezen: ${video.title}` : `Editor losgekoppeld: ${video.title}`,
      entityType: "deliverable",
      entityId: videoId,
      actor: { id: viewer.id, fullName: viewer.fullName },
    });

    revalidatePath(`/videos/${videoId}`);
    revalidatePath("/videos");
    return { ok: true, message: editorId ? "Editor toegewezen." : "Editor losgekoppeld." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Deadline (klantlevering) handmatig zetten of wissen vanuit de lijst.
 *  Een handmatige datum wordt gemarkeerd als "manual" en niet meer automatisch
 *  overschreven door de opnamedatum-herberekening. */
export async function setVideoDeadline(videoId: string, dueOn: string | null): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { ok: false, message: "Ongeldige datum." };
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    await db
      .update(deliverables)
      .set({ dueOn: dueOn ?? null, dueOnSource: dueOn ? "manual" : "auto", updatedAt: new Date() })
      .where(eq(deliverables.id, videoId));

    revalidatePath(`/videos/${videoId}`);
    revalidatePath("/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const commentSchema = z.object({
  body: z.string().trim().min(1, "Schrijf eerst een opmerking.").max(4000),
  visibility: z.enum(["internal", "client"]),
  timecodeMs: z.number().int().nonnegative().nullable().optional(),
});

export async function addComment(
  videoId: string,
  input: { body: string; visibility: "internal" | "client"; timecodeMs?: number | null },
): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    const parsed = commentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message };
    }

    const needed = parsed.data.visibility === "client" ? "comments:write_client" : "comments:write_internal";
    if (!viewer.permissions.has(needed)) {
      return { ok: false, message: "Je mag hier geen opmerking plaatsen." };
    }

    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    const [thread] = await db
      .insert(reviewThreads)
      .values({
        deliverableId: videoId,
        visibility: parsed.data.visibility,
        timecodeMs: parsed.data.timecodeMs ?? null,
      })
      .returning({ id: reviewThreads.id });

    await db.insert(reviewComments).values({
      threadId: thread!.id,
      body: parsed.data.body,
      authorUserId: viewer.id,
      authorName: viewer.fullName,
      source: "shortclips_os",
      timecodeMs: parsed.data.timecodeMs ?? null,
    });

    await recordActivity({
      clientId: video.clientId,
      type: "video.comment_added",
      title: `Feedback geplaatst op ${video.title}`,
      entityType: "deliverable",
      entityId: videoId,
      actor: { id: viewer.id, fullName: viewer.fullName },
      isClientVisible: parsed.data.visibility === "client",
    });

    revalidatePath(`/videos/${videoId}`);
    return { ok: true, message: "Opmerking geplaatst." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function resolveThread(threadId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("comments:write_internal");
    const [thread] = await db
      .select({ id: reviewThreads.id, deliverableId: reviewThreads.deliverableId, isResolved: reviewThreads.isResolved })
      .from(reviewThreads)
      .where(eq(reviewThreads.id, threadId))
      .limit(1);
    if (!thread) return { ok: false, message: "Feedbackdraad niet gevonden." };

    const video = await loadVideo(thread.deliverableId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    await db
      .update(reviewThreads)
      .set({
        isResolved: !thread.isResolved,
        resolvedAt: thread.isResolved ? null : new Date(),
        resolvedById: thread.isResolved ? null : viewer.id,
      })
      .where(eq(reviewThreads.id, threadId));

    revalidatePath(`/videos/${thread.deliverableId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
