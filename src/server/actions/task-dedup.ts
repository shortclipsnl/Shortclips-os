"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";
import { requireOwner, ForbiddenError } from "@/server/auth/context";
import { findDuplicateTaskGroups } from "@/server/task-dedup";

export type ActionResult = { ok: boolean; message?: string; closed?: number };

/**
 * Dubbele open taken samenvoegen: per groep de oudste behouden, de rest sluiten
 * (status done, niet verwijderd — blijft terugvindbaar). Alleen de eigenaar.
 */
export async function mergeDuplicateTasks(): Promise<ActionResult> {
  try {
    await requireOwner();
    const groups = await findDuplicateTaskGroups();
    const closeIds = groups.flatMap((g) => g.closeIds);
    if (closeIds.length === 0) return { ok: true, closed: 0 };

    await db
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(tasks.id, closeIds), isNull(tasks.deletedAt), ne(tasks.status, "done")));

    revalidatePath("/migratie");
    revalidatePath("/tasks");
    return { ok: true, closed: closeIds.length };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
