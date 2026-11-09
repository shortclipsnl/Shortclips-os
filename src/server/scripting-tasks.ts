import "server-only";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";
import { SCRIPTING_TASK_PREFIX } from "@/lib/scripting-task-plan";
import { runJob } from "@/server/jobs/runner";

/**
 * Scriptingtaken — automatisch aanmaken is uitgezet.
 *
 * Scriptingwerk is al volledig zichtbaar op de Scriptingpagina en hoeft niet
 * dubbel als taak op de Takenpagina terug te komen. Daarom maakt het portaal
 * géén automatische scriptingtaken meer aan.
 *
 * Deze module ruimt alleen nog bestaande, automatisch aangemaakte scriptingtaken
 * op: openstaande taken worden gesloten (geannuleerd). Scripts en hun status op
 * de Scriptingpagina blijven volledig ongemoeid — we raken uitsluitend taak-rijen
 * aan met de scripting-sleutel (`scripting:`). Handmatig aangemaakte taken en
 * taken van andere automatiseringen (zoals maandrapportages) blijven staan.
 *
 * De bestaande aanroepers (scripting-acties, agenda-sync, de pagina's als
 * vangnet en de nachtelijke job) blijven werken: ze ruimen nu op in plaats van
 * aan te maken, zodat de bestaande autotaken vanzelf verdwijnen.
 */

export type ScriptingTaskSyncResult = { checked: number; created: number; updated: number; reopened: number; closed: number; failed: number };

const OPEN_STATUSES = ["todo", "in_progress", "blocked"] as const;

/**
 * Sluit openstaande, automatisch aangemaakte scriptingtaken. Met `dayIds` alleen
 * de taken van die opnames; zonder: alle open scriptingtaken. Maakt nooit nieuwe
 * taken aan.
 */
export async function syncScriptingTasks(dayIds?: string[]): Promise<ScriptingTaskSyncResult> {
  const result: ScriptingTaskSyncResult = { checked: 0, created: 0, updated: 0, reopened: 0, closed: 0, failed: 0 };

  const scopeIds = dayIds ? [...new Set(dayIds.filter(Boolean))] : null;
  if (scopeIds && scopeIds.length === 0) return result;

  const where = scopeIds
    ? and(
        like(tasks.dedupeKey, `${SCRIPTING_TASK_PREFIX}%`),
        isNull(tasks.deletedAt),
        inArray(tasks.status, [...OPEN_STATUSES]),
        eq(tasks.entityType, "production_day"),
        inArray(tasks.entityId, scopeIds),
      )
    : and(
        like(tasks.dedupeKey, `${SCRIPTING_TASK_PREFIX}%`),
        isNull(tasks.deletedAt),
        inArray(tasks.status, [...OPEN_STATUSES]),
      );

  const closed = await db
    .update(tasks)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(where)
    .returning({ id: tasks.id });

  result.checked = closed.length;
  result.closed = closed.length;
  return result;
}

/**
 * De oude herinnering "Script afronden/afstemmen" (reminders.script_todo).
 * Eventueel nog openstaande taken daarvan sluiten we als "vervallen".
 */
export async function closeLegacyScriptTodos(): Promise<number> {
  const rows = await db
    .update(tasks)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(and(like(tasks.dedupeKey, "script_todo:%"), isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN_STATUSES])))
    .returning({ id: tasks.id });
  return rows.length;
}

/** Geplande run (na de agenda-sync en 's nachts): ruimt oude scriptingtaken op. */
export async function runScriptingTaskSync() {
  return runJob("system", "scripting.task_sync", {}, async (ctx) => {
    const legacy = await closeLegacyScriptTodos();
    if (legacy) ctx.log(`${legacy} oude script-to-do's gesloten`);
    const r = await syncScriptingTasks();
    ctx.counters.processed = r.checked;
    ctx.counters.updated = r.closed;
    ctx.log(`${r.closed} automatische scriptingtaken opgeruimd (automatische aanmaak staat uit)`);
  });
}

let lastRun = 0;
/**
 * Vangnet bij het laden van Scripting en Taken: hooguit eens per paar minuten
 * per server-instantie, zodat de pagina's niet trager worden.
 */
export async function syncScriptingTasksIfStale(maxAgeMinutes = 5): Promise<void> {
  if (Date.now() - lastRun < maxAgeMinutes * 60_000) return;
  lastRun = Date.now();
  try {
    await syncScriptingTasks();
  } catch (error) {
    console.error("[scripting-tasks] opruimen mislukt", error);
  }
}
