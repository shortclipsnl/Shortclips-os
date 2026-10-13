"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { qcChecks } from "@/db/schema";
import { requirePermission, ForbiddenError } from "@/server/auth/context";
import { assertQcAccess } from "@/server/qc";

export type ActionResult = { ok: boolean; message?: string };

/** Eén QC-controlepunt afvinken of terugzetten (binnen de eigen klanttoegang). */
export async function setQcCheck(qcId: string, done: boolean): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    const ok = await assertQcAccess(viewer, qcId);
    if (!ok) return { ok: false, message: "Controlepunt niet gevonden." };

    await db
      .update(qcChecks)
      .set({ done, doneById: done ? viewer.id : null, doneAt: done ? new Date() : null, updatedAt: new Date() })
      .where(eq(qcChecks.id, qcId));

    revalidatePath("/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
