"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";

export type ActionResult = { ok: boolean; message?: string };

/**
 * Eigen beschikbaarheidsnotitie opslaan: welke dagen/tijden iemand niet
 * beschikbaar is. Alleen voor jezelf — het team leest 'm mee op de capaciteits-
 * en teampagina's.
 */
export async function setMyAvailabilityNote(note: string): Promise<ActionResult> {
  const viewer = await requireInternal();
  const trimmed = note.trim().slice(0, 500);
  await db
    .update(users)
    .set({ availabilityNote: trimmed || null, updatedAt: new Date() })
    .where(eq(users.id, viewer.id));
  revalidatePath("/dashboard");
  return { ok: true };
}
