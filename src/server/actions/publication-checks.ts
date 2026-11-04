"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, publicationChecks } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requireInternal } from "@/server/auth/context";

export type ActionResult = { ok: boolean; message?: string };

/** Wie de publicatiecheck mag afvinken: het publicatie-/contentteam. Editors en
 *  videografen niet — zij doen de edit, niet de publicatiecontrole. */
const ALLOWED_ROLES = ["owner", "admin", "operational_manager", "project_coordinator", "content_creator"];

/** Eén checklistpunt aan/uit zetten. Legt vast wie het afvinkte en wanneer. */
export async function togglePublicationCheck(itemId: string): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    if (!ALLOWED_ROLES.includes(viewer.primaryRole)) {
      return { ok: false, message: "Alleen het publicatieteam mag de publicatiecheck afvinken." };
    }

    const [item] = await db
      .select({
        id: publicationChecks.id,
        done: publicationChecks.done,
        deliverableId: publicationChecks.deliverableId,
        clientId: deliverables.clientId,
      })
      .from(publicationChecks)
      .innerJoin(deliverables, eq(deliverables.id, publicationChecks.deliverableId))
      .where(eq(publicationChecks.id, itemId))
      .limit(1);
    if (!item) return { ok: false, message: "Checklistpunt niet gevonden." };
    assertClientAccess(viewer, item.clientId);

    const next = !item.done;
    await db
      .update(publicationChecks)
      .set({ done: next, doneById: next ? viewer.id : null, doneAt: next ? new Date() : null, updatedAt: new Date() })
      .where(eq(publicationChecks.id, itemId));

    revalidatePath(`/videos/${item.deliverableId}`);
    revalidatePath("/calendar");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
