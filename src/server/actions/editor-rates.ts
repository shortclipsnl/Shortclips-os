"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { editorRates } from "@/db/schema";
import { requirePermission, ForbiddenError } from "@/server/auth/context";

export type ActionResult = { ok: boolean; message?: string };

const schema = z.object({
  userId: z.string().uuid(),
  ratePerVideo: z.coerce.number().min(0).max(100000),
  capacityPerWeek: z.coerce.number().int().min(0).max(200).default(0),
});

/** Tarief per video en weekcapaciteit van een editor instellen. */
export async function upsertEditorRate(input: z.input<typeof schema>): Promise<ActionResult> {
  try {
    await requirePermission("team:write");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    const { userId, ratePerVideo, capacityPerWeek } = parsed.data;

    await db
      .insert(editorRates)
      .values({ userId, ratePerVideo: ratePerVideo.toFixed(2), capacityPerWeek })
      .onConflictDoUpdate({
        target: editorRates.userId,
        set: { ratePerVideo: ratePerVideo.toFixed(2), capacityPerWeek, updatedAt: new Date() },
      });

    revalidatePath("/editing");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
