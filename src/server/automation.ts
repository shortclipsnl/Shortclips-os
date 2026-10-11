import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  approvals,
  automationRules,
  automationRuns,
  clients,
  deliverables,
  productionDays,
  tasks,
  users,
} from "@/db/schema";
import { notify } from "./notifications";
import {
  logError,
} from "./audit";

/**
 * Automation engine.
 *
 * Regels staan in de database (`automation_rules`) en bestaan uit een trigger,
 * voorwaarden en acties. Zo kan een beheerder later regels aanpassen zonder
 * code te wijzigen. Elke uitvoering wordt vastgelegd in `automation_runs`,
 * inclusief resultaat, zodat achteraf te zien is wat het systeem zelf deed.
 */

export type AutomationEvent = {
  trigger: string;
  clientId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Vrije context die voorwaarden en acties mogen gebruiken. */
  data?: Record<string, unknown>;
};

type Action = { type: string } & Record<string, unknown>;

function conditionsMatch(
  conditions: Record<string, unknown>,
  event: AutomationEvent,
): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = event.data?.[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/** Voert alle regels uit die bij deze gebeurtenis passen. */
export async function dispatch(event: AutomationEvent): Promise<void> {
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.trigger, event.trigger),
        eq(automationRules.isEnabled, true),
        isNull(automationRules.deletedAt),
        event.clientId
          ? or(isNull(automationRules.clientId), eq(automationRules.clientId, event.clientId))
          : isNull(automationRules.clientId),
      ),
    );

  for (const rule of rules) {
    if (!conditionsMatch(rule.conditions as Record<string, unknown>, event)) continue;

    const [run] = await db
      .insert(automationRuns)
      .values({
        ruleId: rule.id,
        status: "running",
        triggerEvent: event.trigger,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        context: (event.data ?? {}) as Record<string, unknown>,
        startedAt: new Date(),
      })
      .returning({ id: automationRuns.id });

    const results: unknown[] = [];
    try {
      for (const action of rule.actions as Action[]) {
        results.push(await runAction(action, event));
      }
      await db
        .update(automationRuns)
        .set({ status: "success", finishedAt: new Date(), result: { actions: results } })
        .where(eq(automationRuns.id, run!.id));
      await db
        .update(automationRules)
        .set({ lastRunAt: new Date(), runCount: rule.runCount + 1 })
        .where(eq(automationRules.id, rule.id));
    } catch (error) {
      await logError({ category: "job", source: `automation:${rule.key}`, error });
      await db
        .update(automationRuns)
        .set({
          status: "error",
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
          result: { actions: results },
        })
        .where(eq(automationRuns.id, run!.id));
    }
  }
}

async function runAction(action: Action, event: AutomationEvent): Promise<unknown> {
  switch (action.type) {
    case "set_video_status": {
      if (!event.entityId) return { skipped: "geen video" };
      await db
        .update(deliverables)
        .set({ status: action.status as "approved", statusChangedAt: new Date() })
        .where(eq(deliverables.id, event.entityId));
      return { status: action.status };
    }

    case "create_task": {
      const [row] = await db
        .insert(tasks)
        .values({
          clientId: event.clientId ?? null,
          title: String(action.title ?? "Actie vereist"),
          priority: (action.priority as "normal") ?? "normal",
          status: "todo",
          entityType: event.entityType ?? null,
          entityId: event.entityId ?? null,
          assigneeId: (event.data?.coordinatorId as string) ?? null,
          dueOn: (action.dueOn as string) ?? null,
        })
        .returning({ id: tasks.id });
      return { taskId: row?.id };
    }

    case "create_approval": {
      if (!event.entityId || !event.clientId) return { skipped: true };
      const [row] = await db
        .insert(approvals)
        .values({
          clientId: event.clientId,
          kind: (action.kind as "video") ?? "video",
          entityId: event.entityId,
          status: "pending",
          requestedById: (event.data?.actorId as string) ?? null,
          source: "portal",
        })
        .returning({ id: approvals.id });
      return { approvalId: row?.id };
    }

    case "notify_client": {
      if (!event.clientId) return { skipped: true };
      // Klantgebruikers van deze klant.
      const portalUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.clientId, event.clientId), eq(users.status, "active")));
      const count = await notify({
        userIds: portalUsers.map((u) => u.id),
        clientId: event.clientId,
        type: "portal.action_required",
        level: (action.level as "info") ?? "info",
        title: String(action.title ?? "Er staat iets voor je klaar"),
        href: "/portal",
        entityType: event.entityType,
        entityId: event.entityId,
        dedupeKey: `${action.type}:${event.entityId}:${(event.data?.to as string) ?? ""}`,
      });
      return { notified: count };
    }

    case "notify_coordinator": {
      const coordinatorId = event.data?.coordinatorId as string | undefined;
      const count = await notify({
        userIds: coordinatorId ? [coordinatorId] : [],
        roles: coordinatorId ? undefined : ["project_coordinator"],
        clientId: event.clientId ?? null,
        type: event.trigger,
        level: (action.level as "warning") ?? "warning",
        title: String(action.title ?? "Actie nodig"),
        body: (action.body as string) ?? undefined,
        href: (event.data?.href as string) ?? undefined,
        entityType: event.entityType,
        entityId: event.entityId,
        dedupeKey: `${event.trigger}:${event.entityId}:${(event.data?.to as string) ?? ""}`,
      });
      return { notified: count };
    }

    case "notify_owner":
    case "notify_owner_of_item": {
      const count = await notify({
        roles: ["owner"],
        clientId: event.clientId ?? null,
        type: event.trigger,
        level: (action.level as "warning") ?? "info",
        title: String(action.title ?? event.data?.title ?? "Signaal"),
        href: (event.data?.href as string) ?? undefined,
        entityType: event.entityType,
        entityId: event.entityId,
        dedupeKey: `${event.trigger}:${event.entityId}:${(event.data?.to as string) ?? ""}`,
      });
      return { notified: count };
    }

    case "notify_finance": {
      const count = await notify({
        roles: ["finance", "owner"],
        clientId: event.clientId ?? null,
        type: event.trigger,
        level: (action.level as "warning") ?? "warning",
        title: String(action.title ?? "Financieel signaal"),
        href: "/finance",
        entityType: event.entityType,
        entityId: event.entityId,
        dedupeKey: `${event.trigger}:${event.entityId}:${(event.data?.to as string) ?? ""}`,
      });
      return { notified: count };
    }

    case "flag_production_risk": {
      if (!event.entityId) return { skipped: true };
      await db
        .update(clients)
        .set({
          riskLevel: "high",
          riskReason:
            "Opname staat binnen twee dagen gepland terwijl scripts of benodigdheden nog niet rond zijn.",
        })
        .where(eq(clients.id, event.clientId ?? ""));
      return { flagged: true };
    }

    case "complete_production_if_all_published": {
      const dayId = event.data?.productionDayId as string | undefined;
      if (!dayId) return { skipped: true };
      const remaining = await db
        .select({ id: deliverables.id })
        .from(deliverables)
        .where(
          and(
            eq(deliverables.productionDayId, dayId),
            isNull(deliverables.deletedAt),
            eq(deliverables.status, "published"),
          ),
        );
      const all = await db
        .select({ id: deliverables.id })
        .from(deliverables)
        .where(and(eq(deliverables.productionDayId, dayId), isNull(deliverables.deletedAt)));
      if (remaining.length === all.length && all.length > 0) {
        await db
          .update(productionDays)
          .set({ status: "completed" })
          .where(eq(productionDays.id, dayId));
        return { completed: true };
      }
      return { completed: false, published: remaining.length, total: all.length };
    }

    default:
      return { skipped: `onbekende actie: ${action.type}` };
  }
}
