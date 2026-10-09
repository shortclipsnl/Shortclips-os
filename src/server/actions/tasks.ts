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

/** Meerdere taken in één keer: elke tekstregel wordt een taak (snelle invoer). */
export async function createTasksBulk(input: { lines: string; assigneeId?: string | null }): Promise<ActionResult & { created?: number }> {
  try {
    const viewer = await requirePermission("tasks:write");
    const titles = input.lines
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*•\s]+/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 100);
    if (titles.length === 0) return { ok: false, message: "Typ minstens één taak." };

    const assigneeId = input.assigneeId && /^[0-9a-f-]{36}$/i.test(input.assigneeId) ? input.assigneeId : null;
    await db.insert(tasks).values(
      titles.map((title) => ({ title: title.slice(0, 240), assigneeId, status: "todo" as const, createdById: viewer.id })),
    );

    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { ok: true, created: titles.length };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

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
    revalidatePath("/dashboard");
    return { ok: true, message: "Taak aangemaakt." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const updateSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  dueOn: z.string().nullable().optional(),
});

export async function updateTask(
  taskId: string,
  input: z.input<typeof updateSchema>,
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };

    const [task] = await db
      .select({ id: tasks.id, clientId: tasks.clientId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) return { ok: false, message: "Taak niet gevonden." };
    if (task.clientId) assertClientAccess(viewer, task.clientId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.assigneeId !== undefined) patch.assigneeId = parsed.data.assigneeId;
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    if (parsed.data.dueOn !== undefined) patch.dueOn = parsed.data.dueOn || null;

    await db.update(tasks).set(patch).where(eq(tasks.id, taskId));

    await auditLog({
      viewer,
      action: "task.updated",
      entityType: "task",
      entityId: taskId,
      clientId: task.clientId,
      changes: parsed.data as Record<string, unknown>,
    });

    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    const [task] = await db
      .select({ id: tasks.id, clientId: tasks.clientId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) return { ok: false, message: "Taak niet gevonden." };
    if (task.clientId) assertClientAccess(viewer, task.clientId);

    await db.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, taskId));

    await auditLog({ viewer, action: "task.deleted", entityType: "task", entityId: taskId, clientId: task.clientId });

    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
