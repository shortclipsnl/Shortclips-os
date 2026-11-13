"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { scripts } from "@/db/schema";
import { ForbiddenError, requirePortal } from "@/server/auth/context";
import { recordActivity } from "@/server/audit";
import { dispatch } from "@/server/automation";
import { clientApproveDeliverable, clientRequestChangesDeliverable } from "@/server/portal-video-transitions";

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
    return await clientApproveDeliverable(viewer, videoId);
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
    return await clientRequestChangesDeliverable(viewer, videoId, { summary: parsed.data.body });
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
