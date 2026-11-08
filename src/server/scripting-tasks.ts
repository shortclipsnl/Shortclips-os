import "server-only";
import { and, eq, gte, inArray, isNull, like, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { clients, productionDays, shootScriptSources, tasks, users } from "@/db/schema";
import { subWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import {
  duplicatesToClose,
  planScriptingTask,
  SCRIPTING_TASK_PREFIX,
  scriptingClosedKey,
  type ExistingTask,
  type ScriptingDayState,
} from "@/lib/scripting-task-plan";
import { runJob } from "@/server/jobs/runner";
import { isInactiveClientStatus } from "@/lib/client-status";

/**
 * Scriptingstatus → takenlijst.
 *
 * Elke scriptsessie (opname) met openstaand scriptingwerk krijgt precies één
 * taak op de bestaande takenpagina, toegewezen aan de verantwoordelijke en met
 * de scriptdeadline. De taak loopt mee met de status: bijwerken bij een andere
 * status of verantwoordelijke, automatisch afronden bij Final of wanneer het
 * werk bij de klant ligt, heropenen als het weer terugkomt. De beslisregels
 * staan in `@/lib/scripting-task-plan` (los getest).
 *
 * Aangeroepen vanuit de scripting-acties (direct na een wijziging), na de
 * agenda-sync (opnamedatum of annulering gewijzigd) en vanuit de pagina's als
 * vangnet. Idempotent: vaker draaien geeft nooit dubbele taken.
 */

/** Aantal werkdagen vóór de opname dat de scripts klaar moeten zijn (gelijk aan Scripting). */
const SCRIPT_LEAD_DAYS = 7;
/** Status waarbij het werk bij Jarno (controle) ligt. */
const CONTROLE_JARNO = "controle_jarno";
const OWNER_EMAIL = "jarno@shortclips.nl";

/** Unieke "door het systeem gesloten"-sleutel per taak (zie scriptingClosedKey). */
function closedKeyExpr(dayId: string) {
  return sql`${scriptingClosedKey(dayId)} || ${tasks.id}::text`;
}

function todayAmsterdam(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

/** De sessiemap uit een Drive-pad halen: de map met "sessie" in de naam, anders de directe map. */
function sessionLabelFromPath(path: string | null): string | null {
  if (!path) return null;
  const segs = path.split("/").map((s) => s.trim()).filter(Boolean);
  segs.pop(); // bestandsnaam
  const sessie = segs.find((s) => /\bsessie\b/i.test(s));
  return sessie ?? segs.at(-1) ?? null;
}

async function ownerUserId(): Promise<string | null> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${OWNER_EMAIL}`, isNull(users.deletedAt)))
    .limit(1);
  return u?.id ?? null;
}

export type ScriptingTaskSyncResult = { checked: number; created: number; updated: number; reopened: number; closed: number; failed: number };

/**
 * Synchroniseert de taken van de opgegeven opnames. Zonder `dayIds`: alle
 * aankomende opnames plus alle opnames waar nog een open scriptingtaak aan hangt
 * (zodat ook vervallen of verplaatste opnames netjes worden afgesloten).
 */
export async function syncScriptingTasks(dayIds?: string[]): Promise<ScriptingTaskSyncResult> {
  const result: ScriptingTaskSyncResult = { checked: 0, created: 0, updated: 0, reopened: 0, closed: 0, failed: 0 };
  const today = todayAmsterdam();

  let ids: string[];
  if (dayIds) {
    ids = [...new Set(dayIds.filter(Boolean))];
  } else {
    const upcoming = await db
      .select({ id: productionDays.id })
      .from(productionDays)
      .where(and(isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled"), gte(productionDays.scheduledOn, today)));
    const withOpenTask = await db
      .select({ id: tasks.entityId })
      .from(tasks)
      .where(and(
        like(tasks.dedupeKey, `${SCRIPTING_TASK_PREFIX}%`),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ["todo", "in_progress", "blocked"]),
      ));
    ids = [...new Set([...upcoming.map((r) => r.id), ...withOpenTask.map((r) => r.id).filter((x): x is string => Boolean(x))])];
  }
  if (ids.length === 0) return result;

  const coord = alias(users, "coord_user");
  const dayRows = await db
    .select({
      id: productionDays.id,
      clientId: productionDays.clientId,
      clientName: clients.name,
      clientDeleted: clients.deletedAt,
      clientStatus: clients.status,
      scheduledOn: productionDays.scheduledOn,
      status: productionDays.status,
      deletedAt: productionDays.deletedAt,
      scriptingStatus: productionDays.scriptingStatus,
      note: productionDays.scriptingNote,
      writerId: productionDays.scriptWriterId,
      writerDeleted: users.deletedAt,
      coordinatorId: clients.coordinatorId,
      coordinatorDeleted: coord.deletedAt,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.scriptWriterId))
    .leftJoin(coord, eq(coord.id, clients.coordinatorId))
    .where(inArray(productionDays.id, ids));

  const sources = await db
    .select({ productionDayId: shootScriptSources.productionDayId, filePath: shootScriptSources.filePath })
    .from(shootScriptSources)
    .where(and(inArray(shootScriptSources.productionDayId, ids), eq(shootScriptSources.status, "gekoppeld")));
  const sessionByDay = new Map(sources.map((s) => [s.productionDayId, sessionLabelFromPath(s.filePath)]));

  const taskRows = await db
    .select({
      id: tasks.id,
      entityId: tasks.entityId,
      status: tasks.status,
      dedupeKey: tasks.dedupeKey,
      deletedAt: tasks.deletedAt,
      archivedAt: tasks.archivedAt,
      title: tasks.title,
      description: tasks.description,
      assigneeId: tasks.assigneeId,
      dueOn: tasks.dueOn,
      priority: tasks.priority,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(and(eq(tasks.entityType, "production_day"), inArray(tasks.entityId, ids), like(tasks.dedupeKey, `${SCRIPTING_TASK_PREFIX}%`)));
  const tasksByDay = new Map<string, ExistingTask[]>();
  for (const t of taskRows) {
    if (!t.entityId) continue;
    const arr = tasksByDay.get(t.entityId) ?? [];
    arr.push({
      id: t.id,
      status: t.status,
      dedupeKey: t.dedupeKey,
      deleted: t.deletedAt != null,
      archived: t.archivedAt != null,
      title: t.title,
      description: t.description,
      assigneeId: t.assigneeId,
      dueOn: t.dueOn,
      priority: t.priority,
      createdAt: (t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt as unknown as string)).toISOString(),
    });
    tasksByDay.set(t.entityId, arr);
  }

  const holidays = nlHolidaySet();
  const owner = dayRows.some((d) => d.scriptingStatus === CONTROLE_JARNO) ? await ownerUserId() : null;
  const found = new Set(dayRows.map((d) => d.id));

  // Opnames die helemaal niet meer bestaan (hard verwijderd): open taken sluiten.
  for (const id of ids) {
    if (found.has(id)) continue;
    const open = (tasksByDay.get(id) ?? []).filter((t) => !t.deleted && ["todo", "in_progress", "blocked"].includes(t.status));
    if (open.length === 0) continue;
    await db.update(tasks)
      .set({ status: "cancelled", completedAt: new Date(), dedupeKey: closedKeyExpr(id), updatedAt: new Date() })
      .where(inArray(tasks.id, open.map((t) => t.id)));
    result.closed += open.length;
  }

  for (const d of dayRows) {
    result.checked++;
    try {
      const writer = d.writerId && !d.writerDeleted ? d.writerId : null;
      const coordinator = d.coordinatorId && !d.coordinatorDeleted ? d.coordinatorId : null;
      const responsible = writer ?? coordinator;
      const state: ScriptingDayState = {
        id: d.id,
        clientId: d.clientId,
        clientName: d.clientName,
        scheduledOn: d.scheduledOn,
        deadline: subWorkingDays(d.scheduledOn, SCRIPT_LEAD_DAYS, holidays),
        status: d.scriptingStatus,
        note: d.note,
        assigneeId: d.scriptingStatus === CONTROLE_JARNO ? owner ?? responsible : responsible,
        sessionLabel: sessionByDay.get(d.id) ?? null,
        // Niet actieve klant (centrale klantstatus) telt als vervallen: open
        // scriptingtaken sluiten en geen nieuwe aanmaken. Wordt de klant weer
        // actief, dan ontstaan taken opnieuw voor de aankomende opnames.
        gone: d.deletedAt != null || d.clientDeleted != null || d.status === "cancelled" || d.scheduledOn < today || isInactiveClientStatus(d.clientStatus),
      };
      const existing = tasksByDay.get(d.id) ?? [];

      // Vangnet: mochten er ooit twee open taken voor één opname staan, dan de
      // nieuwere sluiten vóór we bijwerken (unieke sleutel blijft zo geldig).
      const dups = duplicatesToClose(existing);
      if (dups.length) {
        await db.update(tasks)
          .set({ status: "cancelled", completedAt: new Date(), dedupeKey: closedKeyExpr(d.id), updatedAt: new Date() })
          .where(inArray(tasks.id, dups));
        result.closed += dups.length;
        for (const t of existing) if (dups.includes(t.id)) t.status = "cancelled";
      }

      const { plan, retireIds } = planScriptingTask(state, existing, today);
      if (retireIds.length) {
        // Alleen de interne sleutel; status en inhoud blijven zoals ze zijn.
        await db.update(tasks).set({ dedupeKey: closedKeyExpr(d.id) }).where(inArray(tasks.id, retireIds));
      }

      if (plan.type === "insert") {
        const [row] = await db
          .insert(tasks)
          .values({
            clientId: plan.fields.clientId,
            title: plan.fields.title,
            description: plan.fields.description,
            status: "todo",
            priority: plan.fields.priority,
            category: "scripting",
            assigneeId: plan.fields.assigneeId,
            dueOn: plan.fields.dueOn,
            entityType: "production_day",
            entityId: d.id,
            source: "automation",
            dedupeKey: plan.fields.dedupeKey,
          })
          .onConflictDoNothing()
          .returning({ id: tasks.id });
        if (row) result.created++;
      } else if (plan.type === "update") {
        await db.update(tasks)
          .set({
            clientId: plan.fields.clientId,
            title: plan.fields.title,
            description: plan.fields.description,
            priority: plan.fields.priority,
            assigneeId: plan.fields.assigneeId,
            dueOn: plan.fields.dueOn,
            dedupeKey: plan.fields.dedupeKey,
            category: "scripting",
            updatedAt: new Date(),
            ...(plan.reopen ? { status: "todo" as const, completedAt: null, archivedAt: null } : {}),
          })
          .where(eq(tasks.id, plan.id));
        if (plan.reopen) result.reopened++;
        else result.updated++;
      } else if (plan.type === "close") {
        await db.update(tasks)
          .set({ status: plan.status, completedAt: new Date(), dedupeKey: closedKeyExpr(d.id), updatedAt: new Date() })
          .where(inArray(tasks.id, plan.ids));
        result.closed += plan.ids.length;
      }
    } catch (error) {
      result.failed++;
      console.error("[scripting-tasks] sync mislukt voor opname", d.id, error);
    }
  }
  return result;
}

/**
 * De oude herinnering "Script afronden/afstemmen" (reminders.script_todo) is
 * vervangen door deze koppeling. Nog openstaande taken daarvan sluiten we als
 * "vervallen", zodat er geen dubbele scriptingtaken naast elkaar staan.
 */
export async function closeLegacyScriptTodos(): Promise<number> {
  const rows = await db
    .update(tasks)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(and(like(tasks.dedupeKey, "script_todo:%"), isNull(tasks.deletedAt), inArray(tasks.status, ["todo", "in_progress", "blocked"])))
    .returning({ id: tasks.id });
  return rows.length;
}

/** Geplande run (na de agenda-sync en 's nachts). */
export async function runScriptingTaskSync() {
  return runJob("system", "scripting.task_sync", {}, async (ctx) => {
    const legacy = await closeLegacyScriptTodos();
    if (legacy) ctx.log(`${legacy} oude script-to-do's gesloten (vervangen door scriptingtaken)`);
    const r = await syncScriptingTasks();
    ctx.counters.processed = r.checked;
    ctx.counters.created = r.created;
    ctx.counters.updated = r.updated + r.reopened + r.closed;
    ctx.counters.failed = r.failed;
    ctx.log(`${r.checked} opnames gecontroleerd: ${r.created} aangemaakt, ${r.updated} bijgewerkt, ${r.reopened} heropend, ${r.closed} afgerond`);
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
    console.error("[scripting-tasks] vangnet-sync mislukt", error);
  }
}
