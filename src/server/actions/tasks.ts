"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";
import {
  assertClientAccess,
  ForbiddenError,
  requirePermission,
} from "@/server/auth/context";
import { auditLog } from "@/server/audit";

export type ActionResult = { ok: boolean; message?: string };

export async function setTaskStatus(taskId: string, status: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    const [task] = await db
      .select({ id: tasks.id, clientId: tasks.clientId, status: tasks.status, title: tasks.title })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) return { ok: false, message: "Taak niet gevonden." };
    if (task.clientId) assertClientAccess(viewer, task.clientId);

    await db
      .update(tasks)
      .set({
        status: status as "done",
        completedAt: status === "done" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    await auditLog({
      viewer,
      action: "task.status_changed",
      entityType: "task",
      entityId: taskId,
      clientId: task.clientId,
      changes: { van: task.status, naar: status },
    });

    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const createSchema = z.object({
  title: z.string().trim().min(1, "Geef de taak een titel.").max(240),
  clientId: z.string().uuid().nullish(),
  assigneeId: z.string().uuid().nullish(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueOn: z.string().nullish(),
});

export async function createTask(input: z.input<typeof createSchema>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    if (parsed.data.clientId) assertClientAccess(viewer, parsed.data.clientId);

    await db.insert(tasks).values({
      title: parsed.data.title,
      clientId: parsed.data.clientId ?? null,
      assigneeId: parsed.data.assigneeId ?? null,
      priority: parsed.data.priority,
      dueOn: parsed.data.dueOn || null,
      status: "todo",
      createdById: viewer.id,
    });

    revalidatePath("/tasks");
    return { ok: true, message: "Taak aangemaakt." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
