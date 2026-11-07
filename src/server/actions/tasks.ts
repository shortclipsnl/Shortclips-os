"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { productionDays, tasks, users } from "@/db/schema";
import { SCRIPTING_TASK_PREFIX } from "@/lib/scripting-task-plan";
import {
  assertClientAccess,
  ForbiddenError,
  requirePermission,
} from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { notify } from "@/server/notifications";

export type ActionResult = { ok: boolean; message?: string };

/** Meldt de nieuwe verantwoordelijke dat er een taak aan hem/haar is toegewezen.
 *  Niet melden als iemand een taak aan zichzelf toewijst. */
async function notifyAssigned(
  assigneeId: string | null | undefined,
  byName: string,
  byId: string,
  taskId: string,
  title: string,
) {
  if (!assigneeId || assigneeId === byId) return;
  await notify({
    userIds: [assigneeId],
    type: "task_assigned",
    level: "info",
    title: `Taak toegewezen door ${byName}`,
    body: title,
    href: `/tasks?persoon=${assigneeId}`,
    entityType: "task",
    entityId: taskId,
    dedupeKey: `task_assigned:${taskId}:${assigneeId}`,
  });
}

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

// Nog maar twee soorten: Klantcontact of Werkzaamheden. Oude categorieën
// (scripting/overig) vallen automatisch onder Werkzaamheden (zie cleanCategory
// en de weergave), zonder bestaande taken te wijzigen.
const TASK_CATEGORIES = ["klantcontact", "werkzaamheden"] as const;

const createSchema = z.object({
  title: z.string().trim().min(1, "Geef de taak een titel.").max(240),
  description: z.string().trim().max(2000).nullish(),
  clientId: z.string().uuid().nullish(),
  assigneeId: z.string().uuid().nullish(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  category: z.enum(TASK_CATEGORIES).default("werkzaamheden"),
  dueOn: z.string().nullish(),
});

/** Alles behalve "klantcontact" valt onder "werkzaamheden" (ook oude waarden). */
function cleanCategory(c: string | null | undefined): (typeof TASK_CATEGORIES)[number] {
  return c === "klantcontact" ? "klantcontact" : "werkzaamheden";
}

/** Meerdere taken in één keer: elke tekstregel wordt een taak (snelle invoer). */
export async function createTasksBulk(input: { lines: string; assigneeId?: string | null; category?: string | null }): Promise<ActionResult & { created?: number }> {
  try {
    const viewer = await requirePermission("tasks:write");
    const titles = input.lines
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*•\s]+/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 100);
    if (titles.length === 0) return { ok: false, message: "Typ minstens één taak." };

    const assigneeId = input.assigneeId && /^[0-9a-f-]{36}$/i.test(input.assigneeId) ? input.assigneeId : null;
    const category = cleanCategory(input.category);

    // Dubbele taken voorkomen: staat dezelfde taak al open, of is hij de
    // afgelopen 7 dagen door iemand afgerond, dan slaan we hem over en melden
    // we bij wie hij staat. Zo blijft er per taak één eigenaar.
    const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
    const since = new Date(Date.now() - 7 * 86_400_000);
    const existing = await db
      .select({ title: tasks.title, status: tasks.status, who: users.fullName })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(
        isNull(tasks.deletedAt),
        or(inArray(tasks.status, ["todo", "in_progress", "blocked"]), and(eq(tasks.status, "done"), gte(tasks.completedAt, since))),
      ))
      .limit(2000);
    const known = new Map(existing.map((e) => [norm(e.title), e]));
    const seen = new Set<string>();
    const skipped: string[] = [];
    const fresh = titles.filter((t) => {
      const k = norm(t);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      const hit = known.get(k);
      if (hit) {
        const who = hit.who ? hit.who.split(" ")[0] : "niemand";
        skipped.push(`"${t}" (${hit.status === "done" ? `al afgerond door ${who}` : `staat al open bij ${who}`})`);
        return false;
      }
      return true;
    });
    const skipNote = skipped.length ? `${skipped.length} overgeslagen: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? " …" : ""}` : undefined;
    if (fresh.length === 0) return { ok: false, message: skipNote ?? "Niets toe te voegen." };

    const inserted = await db.insert(tasks).values(
      fresh.map((title) => ({ title: title.slice(0, 240), assigneeId, category, status: "todo" as const, createdById: viewer.id })),
    ).returning({ id: tasks.id });

    // Eén melding voor de hele batch als die aan iemand anders is toegewezen.
    if (assigneeId && assigneeId !== viewer.id && inserted[0]) {
      await notify({
        userIds: [assigneeId],
        type: "task_assigned",
        level: "info",
        title: `${fresh.length} ${fresh.length === 1 ? "taak" : "taken"} toegewezen door ${viewer.fullName}`,
        body: fresh.slice(0, 5).join(" · "),
        href: `/tasks?persoon=${assigneeId}`,
        entityType: "task",
        entityId: inserted[0].id,
        dedupeKey: `task_assigned_bulk:${inserted[0].id}:${assigneeId}`,
      });
    }

    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { ok: true, created: fresh.length, message: skipNote };
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

    const [created] = await db.insert(tasks).values({
      title: parsed.data.title,
      description: parsed.data.description || null,
      clientId: parsed.data.clientId ?? null,
      assigneeId: parsed.data.assigneeId ?? null,
      priority: parsed.data.priority,
      category: parsed.data.category,
      dueOn: parsed.data.dueOn || null,
      status: "todo",
      createdById: viewer.id,
    }).returning({ id: tasks.id });

    await notifyAssigned(parsed.data.assigneeId, viewer.fullName, viewer.id, created!.id, parsed.data.title);

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
  description: z.string().trim().max(2000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
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
      .select({ id: tasks.id, clientId: tasks.clientId, assigneeId: tasks.assigneeId, title: tasks.title, entityType: tasks.entityType, entityId: tasks.entityId, dedupeKey: tasks.dedupeKey })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) return { ok: false, message: "Taak niet gevonden." };
    if (task.clientId) assertClientAccess(viewer, task.clientId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description || null;
    if (parsed.data.assigneeId !== undefined) patch.assigneeId = parsed.data.assigneeId;
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    if (parsed.data.category !== undefined) patch.category = parsed.data.category;
    if (parsed.data.dueOn !== undefined) patch.dueOn = parsed.data.dueOn || null;

    await db.update(tasks).set(patch).where(eq(tasks.id, taskId));

    // Automatische scriptingtaak overgedragen → ook de verantwoordelijke van de
    // scriptsessie aanpassen, anders zet de koppeling de taak weer terug. Bij
    // "Controle Jarno" ligt het werk bewust bij Jarno; dan blijft de
    // scriptschrijver ongemoeid.
    if (
      parsed.data.assigneeId !== undefined &&
      parsed.data.assigneeId !== task.assigneeId &&
      task.entityType === "production_day" &&
      task.entityId &&
      task.dedupeKey?.startsWith(SCRIPTING_TASK_PREFIX)
    ) {
      await db
        .update(productionDays)
        .set({ scriptWriterId: parsed.data.assigneeId, updatedAt: new Date() })
        .where(and(eq(productionDays.id, task.entityId), ne(productionDays.scriptingStatus, "controle_jarno")));
      revalidatePath("/scripting");
    }

    // Overdragen aan een ander teamlid → die persoon krijgt een melding.
    if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== task.assigneeId) {
      await notifyAssigned(parsed.data.assigneeId, viewer.fullName, viewer.id, taskId, parsed.data.title ?? task.title);
    }

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
