"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { editorAwards, editorPreferences } from "@/db/schema";
import { ForbiddenError, requireInternal } from "@/server/auth/context";

export type AwardActionResult = { ok: boolean; message?: string };

/** Geluid bij awards aan/uit voor de ingelogde editor. */
export async function setAwardSound(enabled: boolean): Promise<AwardActionResult> {
  try {
    const viewer = await requireInternal();
    await db
      .insert(editorPreferences)
      .values({ userId: viewer.id, awardSound: enabled })
      .onConflictDoUpdate({ target: editorPreferences.userId, set: { awardSound: enabled, updatedAt: new Date() } });
    revalidatePath("/showcase");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Markeert de nog niet gevierde awards van de ingelogde editor als gevierd (na het openen van de viering). */
export async function markCelebrated(): Promise<AwardActionResult> {
  try {
    const viewer = await requireInternal();
    await db
      .update(editorAwards)
      .set({ celebratedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(editorAwards.editorId, viewer.id), isNull(editorAwards.celebratedAt)));
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
