"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { handoverNotes } from "@/db/schema";
import { ForbiddenError, requirePermission } from "@/server/auth/context";

export type HandoverResult = { ok: boolean; message?: string };

const createSchema = z.object({
  body: z.string().trim().min(1, "Schrijf een korte overdracht.").max(2000),
  forUserId: z.string().uuid().optional().nullable(),
});

/** Nieuwe overdrachtsnotitie plaatsen (kernteam). */
export async function createHandoverNote(input: { body: string; forUserId?: string | null }): Promise<HandoverResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige invoer." };
    await db.insert(handoverNotes).values({
      authorId: viewer.id,
      forUserId: parsed.data.forUserId || null,
      body: parsed.data.body,
    });
    revalidatePath("/tasks");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Overdracht op "gedaan" zetten of terugzetten. */
export async function resolveHandoverNote(id: string, resolved: boolean): Promise<HandoverResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    await db
      .update(handoverNotes)
      .set({ resolvedAt: resolved ? new Date() : null, resolvedById: resolved ? viewer.id : null, updatedAt: new Date() })
      .where(eq(handoverNotes.id, id));
    revalidatePath("/tasks");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Overdracht verwijderen (soft delete). */
export async function deleteHandoverNote(id: string): Promise<HandoverResult> {
  try {
    await requirePermission("tasks:write");
    await db.update(handoverNotes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(handoverNotes.id, id));
    revalidatePath("/tasks");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
