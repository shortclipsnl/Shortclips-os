"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { resultAlerts, tasks } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { notify } from "@/server/notifications";
import { runResultAlerts } from "@/server/result-alerts";

export type ActionResult = { ok: boolean; message?: string };

function refresh() {
  revalidatePath("/analytics");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/scripting");
  revalidatePath("/contentgeheugen");
}

async function loadAlert(alertId: string) {
  const [a] = await db.select().from(resultAlerts).where(eq(resultAlerts.id, alertId)).limit(1);
  return a ?? null;
}

const createSchema = z.object({
  alertId: z.string().uuid(),
  assigneeId: z.string().uuid({ message: "Kies een verantwoordelijke." }),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Kies een deadline."),
  title: z.string().trim().min(3, "Geef de actie een titel.").max(240),
  description: z.string().trim().max(4000).optional(),
});

/**
 * Zet een alert om in een taak op de bestaande takenpagina. Eén open taak per
 * alert: bestaat die al, dan wordt hij hergebruikt in plaats van verdubbeld.
 */
export async function createResultAlertTask(input: z.input<typeof createSchema>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    const alert = await loadAlert(parsed.data.alertId);
    if (!alert) return { ok: false, message: "Alert niet gevonden." };
    assertClientAccess(viewer, alert.clientId);
    if (alert.status !== "open" && alert.status !== "actie") return { ok: false, message: "Deze alert is al afgehandeld." };

    if (alert.taskId) {
      const [t] = await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(and(eq(tasks.id, alert.taskId), isNull(tasks.deletedAt))).limit(1);
      if (t && t.status !== "done") return { ok: false, message: "Er loopt al een taak voor deze alert. Pas die aan op de takenpagina." };
    }

    const dedupeKey = `result_alert:${alert.id}`;
    const inserted = await db
      .insert(tasks)
      .values({
        clientId: alert.clientId,
        title: parsed.data.title,
        description: parsed.data.description || null,
        assigneeId: parsed.data.assigneeId,
        dueOn: parsed.data.dueOn,
        priority: alert.level === "rood" ? "high" : "normal",
        category: "werkzaamheden",
        status: "todo",
        entityType: "result_alert",
        entityId: alert.id,
        source: "manual",
        dedupeKey,
        createdById: viewer.id,
      })
      .onConflictDoNothing()
      .returning({ id: tasks.id });

    let taskId = inserted[0]?.id ?? null;
    if (!taskId) {
      const [open] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dedupeKey, dedupeKey), ne(tasks.status, "done"), isNull(tasks.deletedAt))).limit(1);
      taskId = open?.id ?? null;
      if (!taskId) return { ok: false, message: "De taak kon niet worden aangemaakt. Probeer het opnieuw." };
    }

    await db
      .update(resultAlerts)
      .set({
        status: "actie",
        taskId,
        assigneeId: parsed.data.assigneeId,
        actionText: parsed.data.title,
        actionAt: sql`coalesce(${resultAlerts.actionAt}, now())`,
        updatedAt: new Date(),
      })
      .where(eq(resultAlerts.id, alert.id));

    if (inserted[0] && parsed.data.assigneeId !== viewer.id) {
      await notify({
        userIds: [parsed.data.assigneeId],
        type: "task_assigned",
        level: "info",
        title: `Taak toegewezen door ${viewer.fullName}`,
        body: parsed.data.title,
        href: `/tasks?persoon=${parsed.data.assigneeId}`,
        entityType: "task",
        entityId: taskId,
        dedupeKey: `task_assigned:${taskId}:${parsed.data.assigneeId}`,
      });
    }

    refresh();
    return { ok: true, message: inserted[0] ? "Taak aangemaakt op de takenpagina." : "Bestaande taak gekoppeld." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const resolveSchema = z.object({
  alertId: z.string().uuid(),
  mode: z.enum(["opgelost", "geen_actie"]),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Markeer als opgelost: "opgelost" = er is een verbeteractie uitgevoerd (de
 * effectmeting gaat lopen); "geen_actie" = bewust afgehandeld zonder actie.
 */
export async function resolveResultAlert(input: z.input<typeof resolveSchema>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    const parsed = resolveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    const alert = await loadAlert(parsed.data.alertId);
    if (!alert) return { ok: false, message: "Alert niet gevonden." };
    assertClientAccess(viewer, alert.clientId);
    if (alert.status !== "open" && alert.status !== "actie") return { ok: false, message: "Deze alert is al afgehandeld." };
    if (parsed.data.mode === "opgelost" && !alert.actionText && !parsed.data.note) {
      return { ok: false, message: "Beschrijf kort welke actie is uitgevoerd, zodat we het effect kunnen terugzien." };
    }

    const now = new Date();
    await db
      .update(resultAlerts)
      .set({
        status: parsed.data.mode === "opgelost" ? "opgelost" : "afgehandeld",
        resolvedAt: now,
        resolvedById: viewer.id,
        resolutionNote: parsed.data.note || null,
        actionText: alert.actionText ?? (parsed.data.mode === "opgelost" ? parsed.data.note ?? null : null),
        actionAt: parsed.data.mode === "opgelost" ? (alert.actionAt ?? now) : alert.actionAt,
        updatedAt: now,
      })
      .where(eq(resultAlerts.id, alert.id));

    refresh();
    return {
      ok: true,
      message: parsed.data.mode === "opgelost" ? "Afgehandeld. Het effect wordt gemeten zodra er nieuwe video's online staan." : "Afgehandeld zonder actie.",
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Andere verantwoordelijke kiezen (zonder taak). */
export async function reassignResultAlert(alertId: string, assigneeId: string | null): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    const alert = await loadAlert(alertId);
    if (!alert) return { ok: false, message: "Alert niet gevonden." };
    assertClientAccess(viewer, alert.clientId);
    await db.update(resultAlerts).set({ assigneeId, updatedAt: new Date() }).where(eq(resultAlerts.id, alertId));
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Analyse direct opnieuw draaien (anders dagelijks automatisch). */
export async function rerunResultAlerts(): Promise<ActionResult> {
  try {
    await requirePermission("tasks:write");
    const r = await runResultAlerts({ budgetMs: 50_000 });
    refresh();
    return { ok: true, message: `${r.analyzed} klanten geanalyseerd: ${r.created} nieuw, ${r.updated} bijgewerkt, ${r.expired} vervallen.` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
