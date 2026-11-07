import "server-only";
import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { opsControlItems, opsControlRuns, tasks, users, type OpsDomainHealth, type OpsRunSummary } from "@/db/schema";
import { notify } from "@/server/notifications";
import { runJob } from "@/server/jobs/runner";
import { isCoreStaff } from "@/server/core-staff";
import { nlHolidaySet } from "@/lib/holidays";
import { isClosedKey } from "@/lib/scripting-task-plan";
import {
  afternoonDigest, amsterdamClock, dueSlot, morningDigest, opsRetiredKey, opsTaskKey, planItems, topLines,
  type Decision, type Finding, type ItemState, type OpsSlot,
} from "@/lib/ops-control/plan";
import { collectFindings, type CollectResult } from "./findings";
import { getOpsSettings, resolveEscalationPeople, type EscalationPeople } from "./settings";

/**
 * Operationele controle: draait om 09:00 en 15:00 (Amsterdam, werkdagen).
 * Leest de bronnen, houdt per probleem één punt en één taak bij, rondt af wat
 * echt is opgelost, heropent wat alleen is afgevinkt, escaleert wat blijft
 * liggen en stuurt iedereen één persoonlijk overzicht met alleen zijn eigen
 * punten. Idempotent: een tweede run op hetzelfde moment doet niets dubbel.
 */


const TASK_CATEGORY: Record<string, string> = {
  scripting: "scripting", klantfeedback: "klantcontact", klantcommunicatie: "klantcontact",
};

export type RunOptions = {
  slot: OpsSlot;
  now?: Date;
  triggeredById?: string | null;
  /** Alleen voor tests: bronnen vervangen. */
  collect?: (today: string, holidays: Set<string>) => Promise<CollectResult>;
};

export type RunResult = { ok: boolean; skipped?: string; runId?: string; summary?: OpsRunSummary };

/** Cron-ingang (elk kwartier op werkdagen): draait alleen als een controlemoment aan de beurt is. */
export async function runOpsControlScheduled(now = new Date()): Promise<RunResult> {
  const settings = await getOpsSettings();
  if (!settings.enabled) return { ok: true, skipped: "Operationele controle staat uit." };
  const clock = amsterdamClock(now);
  const holidays = nlHolidaySet();
  const doneRows = await db.select({ slot: opsControlRuns.slot }).from(opsControlRuns)
    .where(and(eq(opsControlRuns.runDate, clock.date), ne(opsControlRuns.slot, "handmatig")));
  const done = new Set(doneRows.map((r) => r.slot as "ochtend" | "middag"));
  const slot = dueSlot(clock, { ochtend: settings.morning, middag: settings.afternoon }, done, holidays);
  if (!slot) return { ok: true, skipped: `Geen controlemoment aan de beurt (${clock.date} ${String(Math.floor(clock.minutes / 60)).padStart(2, "0")}:${String(clock.minutes % 60).padStart(2, "0")}).` };
  return runOpsControl({ slot, now });
}

export async function runOpsControl(opts: RunOptions): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const clock = amsterdamClock(now);
  const today = clock.date;
  const holidays = nlHolidaySet();

  // Run vastleggen; de unieke index voorkomt dat hetzelfde moment twee keer draait.
  const [run] = await db.insert(opsControlRuns)
    .values({ runDate: today, slot: opts.slot, startedAt: now, triggeredById: opts.triggeredById ?? null })
    .onConflictDoNothing()
    .returning({ id: opsControlRuns.id });
  if (!run) return { ok: true, skipped: `De ${opts.slot}controle van ${today} is al uitgevoerd.` };

  const summary: OpsRunSummary = { domains: [], open: 0, created: 0, updated: 0, resolvedAuto: 0, reopened: 0, escalated: 0, notified: 0, errors: [] };
  const res = await runJob("system", `ops.control.${opts.slot}`, { date: today }, async (ctx) => {
    const settings = await getOpsSettings();
    const people = await resolveEscalationPeople(settings);
    const collected = await (opts.collect ?? collectFindings)(today, holidays);
    summary.domains = collected.health;
    summary.errors.push(...collected.errors);
    for (const e of collected.errors) ctx.log(e, "warn");

    // Punten zonder verantwoordelijke → de operationeel verantwoordelijke.
    for (const f of collected.findings) if (!f.ownerId) f.ownerId = people.leadId;

    const decisions = await reconcile(collected, today, holidays, settings.jarnoAfterWorkdays, settings.dueTime, people, summary);
    ctx.counters.processed = decisions.length;

    if (opts.slot !== "handmatig") {
      summary.notified += await sendDigests(opts.slot, today);
    }
    summary.notified += await sendEscalations(decisions, people, today);

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(opsControlItems).where(eq(opsControlItems.status, "open"));
    summary.open = Number(n);
    ctx.counters.created = summary.created;
    ctx.counters.updated = summary.updated;
    ctx.log(`${opts.slot}: ${summary.open} open · ${summary.created} nieuw · ${summary.resolvedAuto} opgelost · ${summary.reopened} heropend · ${summary.escalated} geëscaleerd · ${summary.notified} meldingen`);
  });

  await db.update(opsControlRuns)
    .set({ status: res.ok ? "success" : "error", finishedAt: new Date(), summary, error: res.error ?? null, updatedAt: new Date() })
    .where(eq(opsControlRuns.id, run.id));
  return { ok: res.ok, runId: run.id, summary };
}

/* ------------------------------------------------------------------ *
 * Punten en taken bijwerken
 * ------------------------------------------------------------------ */

async function reconcile(
  collected: CollectResult, today: string, holidays: Set<string>, jarnoAfterWorkdays: number, dueTime: string,
  people: EscalationPeople, summary: OpsRunSummary,
): Promise<Decision[]> {
  const findings = collected.findings;
  const keys = findings.map((f) => f.key);

  // Alle open punten + afgesloten punten die nu weer gevonden worden.
  const rows = await db.select().from(opsControlItems).where(or(
    eq(opsControlItems.status, "open"),
    keys.length ? inArray(opsControlItems.itemKey, keys) : sql`false`,
  ));
  // Onderdelen waarvan de bron niet bereikbaar was: open punten niet afsluiten.
  const unavailable = new Set(collected.health.filter((h: OpsDomainHealth) => h.check === "unavailable").map((h) => h.domain));
  const usable = rows.filter((r) => !(r.status === "open" && unavailable.has(r.domain) && !keys.includes(r.itemKey)));

  // Status van alle betrokken taken (eigen taken én gekoppelde bestaande taken).
  const linkedIds = findings.map((f) => f.linkedTaskId).filter((x): x is string => Boolean(x));
  const taskIds = [...new Set([...usable.map((r) => r.taskId).filter((x): x is string => Boolean(x)), ...linkedIds])];
  const taskRows = taskIds.length
    ? await db.select({ id: tasks.id, status: tasks.status, deletedAt: tasks.deletedAt, dedupeKey: tasks.dedupeKey, description: tasks.description }).from(tasks).where(inArray(tasks.id, taskIds))
    : [];
  const taskById = new Map(taskRows.map((t) => [t.id, t]));

  const states: ItemState[] = usable.map((r) => {
    const t = r.taskId ? taskById.get(r.taskId) : undefined;
    return {
      id: r.id, itemKey: r.itemKey, status: r.status as "open" | "resolved", resolution: r.resolution,
      ownerId: r.ownerId, dueOn: r.dueOn, taskId: r.taskId,
      taskStatus: t && !t.deletedAt ? t.status : null,
      escalationLevel: r.escalationLevel, escalatedAt: r.escalatedAt ? amsterdamClock(r.escalatedAt).date : null,
      jarnoNotified: r.jarnoNotifiedAt != null, snoozedUntil: r.snoozedUntil, manualDoneCount: r.manualDoneCount,
    };
  });
  const rowByKey = new Map(usable.map((r) => [r.itemKey, r]));

  const decisions = planItems(findings, states, { today, holidays, jarnoAfterWorkdays });
  const names = await firstNames();

  for (const d of decisions) {
    const f = d.finding;
    const row = rowByKey.get(d.key);
    const nowTs = new Date();

    if (d.item === "resolve" && !f) {
      // Opgelost in de bron. Bij een gekoppelde bestaande taak (scripting of een
      // gewone taak): was die door het systeem gesloten of door iemand afgevinkt?
      const linked = row ? isLinkedKey(row.itemKey) : false;
      let resolution: "auto" | "manual" = "auto";
      if (linked && row?.taskId) {
        const t = taskById.get(row.taskId);
        if (t && t.status === "done" && !isClosedKey(t.dedupeKey)) resolution = "manual";
      }
      await db.update(opsControlItems).set({ status: "resolved", resolution, resolvedAt: nowTs, updatedAt: nowTs }).where(eq(opsControlItems.id, d.itemId!));
      if (!linked && d.task === "close" && row?.taskId) {
        await db.update(tasks).set({
          status: "done", completedAt: nowTs, updatedAt: nowTs,
          description: sql`coalesce(${tasks.description}, '') || ${"\n\nAutomatisch afgerond door de operationele controle: het probleem is in de Hub opgelost."}`,
        }).where(eq(tasks.id, row.taskId));
      }
      if (resolution === "auto") summary.resolvedAuto++;
      continue;
    }
    if (!f) continue;
    if (d.item === "none") continue;

    // Eigen taak die niet meer bij het punt hoort: sleutel vrijgeven.
    if (d.retireTaskId) {
      await db.update(tasks).set({ dedupeKey: opsRetiredKey(f.key, d.retireTaskId) }).where(eq(tasks.id, d.retireTaskId));
    }

    if (d.item === "resolve" && d.resolution === "manual") {
      await db.update(opsControlItems).set({
        status: "resolved", resolution: "manual", resolvedAt: nowTs, snoozedUntil: d.snoozeUntil, updatedAt: nowTs,
        ownerId: f.ownerId, action: f.action, reason: f.reason,
      }).where(eq(opsControlItems.id, d.itemId!));
      continue;
    }

    // Punt opslaan (nieuw, heropend of bijgewerkt).
    const values = {
      itemKey: f.key, domain: f.domain, category: f.category, clientId: f.clientId, clientLabel: f.clientLabel,
      ownerId: f.ownerId, action: f.action, reason: f.reason, href: f.href, priority: f.priority, severity: f.severity,
      dueOn: d.dueOn, verifiable: f.verifiable, status: "open" as const, lastSeenAt: nowTs, updatedAt: nowTs,
    };
    let itemId = d.itemId;
    if (d.item === "insert") {
      const reset = {
        ...values, resolution: null, resolvedAt: null, snoozedUntil: null, escalationLevel: 0, escalatedAt: null,
        escalatedToId: null, jarnoNotifiedAt: null, manualDoneCount: 0, firstSeenAt: nowTs,
      };
      const [r] = await db.insert(opsControlItems).values(reset)
        .onConflictDoUpdate({ target: opsControlItems.itemKey, set: reset })
        .returning({ id: opsControlItems.id });
      itemId = r!.id;
      summary.created++;
    } else {
      await db.update(opsControlItems).set({
        ...values,
        ...(d.manualDoneDetected ? { manualDoneCount: sql`${opsControlItems.manualDoneCount} + 1` } : {}),
      }).where(eq(opsControlItems.id, itemId!));
      summary.updated++;
    }

    // Gekoppelde bestaande taak (scripting/gewone taak) onthouden.
    if (!f.createTask && f.linkedTaskId) {
      await db.update(opsControlItems).set({ taskId: f.linkedTaskId }).where(eq(opsControlItems.id, itemId!));
    }

    // Taak aanmaken of bijwerken.
    if (f.createTask && d.task !== "none") {
      const fields = taskFields(f, d.dueOn, dueTime, today, names, d.escalateTo != null || (row?.escalationLevel ?? 0) > 0);
      const existingId = d.task === "create" ? null : row?.taskId ?? null;
      if (existingId) {
        await db.update(tasks).set({
          ...fields, updatedAt: nowTs,
          ...(d.task === "reopen" ? {
            status: "todo" as const, completedAt: null, archivedAt: null,
            description: `Heropend door de controle: deze taak was afgerond, maar in de Hub staat het probleem nog open. Werk eerst de status bij op de plek waar het probleem staat.\n\n${fields.description}`,
          } : {}),
        }).where(eq(tasks.id, existingId));
        if (d.task === "reopen") summary.reopened++;
      } else {
        const [t] = await db.insert(tasks).values({
          ...fields, status: "todo", source: "automation", entityType: "ops_control_item", entityId: itemId!,
          dedupeKey: opsTaskKey(f.key),
        }).onConflictDoNothing().returning({ id: tasks.id });
        let taskId = t?.id ?? null;
        if (!taskId) {
          // Er stond al een open taak met deze sleutel (bijv. gelijktijdige run): die gebruiken.
          const [ex] = await db.select({ id: tasks.id }).from(tasks)
            .where(and(eq(tasks.dedupeKey, opsTaskKey(f.key)), isNull(tasks.deletedAt), ne(tasks.status, "done"))).limit(1);
          taskId = ex?.id ?? null;
        }
        if (d.manualDoneDetected) summary.reopened++;
        if (taskId) await db.update(opsControlItems).set({ taskId }).where(eq(opsControlItems.id, itemId!));
      }
    }

    // Escalatie vastleggen.
    if (d.escalateTo) {
      const target = d.escalateTo === 2 ? people.jarnoId : escalationTarget(f.ownerId, people);
      if (target || d.escalateTo === 2) {
        await db.update(opsControlItems).set({
          escalationLevel: d.escalateTo,
          escalatedAt: d.escalateTo === 1 || !row?.escalatedAt ? nowTs : row.escalatedAt,
          escalatedToId: d.escalateTo === 1 ? target : row?.escalatedToId ?? null,
          ...(d.notifyJarno ? { jarnoNotifiedAt: nowTs } : {}),
        }).where(eq(opsControlItems.id, itemId!));
        if (f.createTask) {
          const tid = (await db.select({ taskId: opsControlItems.taskId }).from(opsControlItems).where(eq(opsControlItems.id, itemId!)))[0]?.taskId;
          if (tid) await db.update(tasks).set({ priority: "urgent" }).where(eq(tasks.id, tid));
        }
        summary.escalated++;
      }
    }
  }
  return decisions;
}

/** Punten die meeliften op een bestaande taak (geen eigen controletaak). */
const isLinkedKey = (key: string) => key.startsWith("taken:") || key.startsWith("scripting:");

/** Wie krijgt niveau 2: de operationeel verantwoordelijke, of de vervanger als het punt bij haar/hem zelf ligt. */
export function escalationTarget(ownerId: string | null, people: EscalationPeople): string | null {
  if (people.leadId && people.leadId !== ownerId) return people.leadId;
  if (people.backupId && people.backupId !== ownerId) return people.backupId;
  return null;
}

async function firstNames(): Promise<Map<string, string>> {
  const rows = await db.select({ id: users.id, fullName: users.fullName }).from(users);
  return new Map(rows.map((r) => [r.id, r.fullName.trim().split(/\s+/)[0] ?? r.fullName]));
}

function nlDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function taskFields(f: Finding, dueOn: string | null, dueTime: string, today: string, names: Map<string, string>, escalated: boolean) {
  const deadline = !dueOn ? "Geen" : dueOn === today ? `Vandaag om ${dueTime} uur` : dueOn < today ? `${nlDate(dueOn)} (verstreken)` : nlDate(dueOn);
  const lines = [
    f.clientLabel ? `Klant: ${f.clientLabel}` : null,
    `Verantwoordelijke: ${f.ownerId ? names.get(f.ownerId) ?? "onbekend" : "nog niet toegewezen"}`,
    `Probleem: ${f.reason}`,
    `Actie: ${f.action} en status bijwerken`,
    `Deadline: ${deadline}`,
    f.verifiable
      ? "Deze taak rondt automatisch af zodra het in de Hub is opgelost."
      : "Dit kan de Hub niet zelf controleren: rond de taak af als je het hebt gedaan.",
  ].filter(Boolean);
  return {
    title: (f.clientLabel ? `${f.clientLabel} | ${f.action}` : f.action).slice(0, 240),
    description: lines.join("\n"),
    assigneeId: f.ownerId,
    clientId: f.clientId,
    dueOn,
    priority: (escalated || f.severity === "rood" ? "urgent" : f.priority === "hoog" ? "high" : "normal") as "urgent" | "high" | "normal",
    category: TASK_CATEGORY[f.domain] ?? "overig",
  };
}

/* ------------------------------------------------------------------ *
 * Meldingen
 * ------------------------------------------------------------------ */

type OpenRow = { id: string; ownerId: string | null; clientLabel: string | null; action: string; dueOn: string | null; severity: string; priority: string };

async function openItemsByOwner(): Promise<Map<string, OpenRow[]>> {
  const rows = await db.select({
    id: opsControlItems.id, ownerId: opsControlItems.ownerId, clientLabel: opsControlItems.clientLabel,
    action: opsControlItems.action, dueOn: opsControlItems.dueOn, severity: opsControlItems.severity, priority: opsControlItems.priority,
  }).from(opsControlItems).where(eq(opsControlItems.status, "open"));
  const by = new Map<string, OpenRow[]>();
  for (const r of rows) {
    if (!r.ownerId) continue;
    by.set(r.ownerId, [...(by.get(r.ownerId) ?? []), r]);
  }
  for (const list of by.values()) {
    list.sort((a, b) => (a.severity === "rood" ? 0 : 1) - (b.severity === "rood" ? 0 : 1) || (a.dueOn ?? "9").localeCompare(b.dueOn ?? "9"));
  }
  return by;
}

/** Eén persoonlijke melding per medewerker per controlemoment, alleen met eigen punten. */
async function sendDigests(slot: "ochtend" | "middag", today: string): Promise<number> {
  const byOwner = await openItemsByOwner();
  const people = await db.select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status, deletedAt: users.deletedAt }).from(users)
    .where(inArray(users.id, [...byOwner.keys()].length ? [...byOwner.keys()] : ["00000000-0000-0000-0000-000000000000"]));
  let sent = 0;
  for (const p of people) {
    // Alleen het interne kernteam; editors krijgen hun eigen deadlinemeldingen.
    if (!isCoreStaff(p.email) || p.deletedAt || p.status !== "active") continue;
    const list = byOwner.get(p.id) ?? [];
    const first = p.fullName.trim().split(/\s+/)[0] ?? p.fullName;
    if (slot === "ochtend") {
      const msg = morningDigest(first, list);
      if (!msg) continue;
      sent += await notify({
        userIds: [p.id], type: "ops_control", level: list.some((i) => i.severity === "rood") ? "warning" : "info",
        title: msg.title, body: `${topLines(list)}. ${msg.body}`, href: "/tasks",
        dedupeKey: `opscontrol:ochtend:${p.id}:${today}`,
      });
    } else {
      const due = list.filter((i) => i.dueOn != null && i.dueOn <= today);
      const msg = afternoonDigest(due);
      if (!msg) continue;
      sent += await notify({
        userIds: [p.id], type: "ops_control", level: "warning",
        title: msg.title, body: `${topLines(due)}. ${msg.body}`, href: "/tasks",
        dedupeKey: `opscontrol:middag:${p.id}:${today}`,
      });
      // Belangrijke deadline vandaag: max. twee losse meldingen, de rest staat in het overzicht.
      for (const it of due.filter((i) => i.dueOn === today && i.priority === "hoog").slice(0, 2)) {
        sent += await notify({
          userIds: [p.id], type: "ops_control_deadline", level: "warning",
          title: it.clientLabel ? `${it.action} voor ${it.clientLabel} moet vandaag gebeuren.` : `${it.action} moet vandaag gebeuren.`,
          body: "Deze taak staat nog open.", href: `/controle/${it.id}`,
          dedupeKey: `opscontrol:deadline:${it.id}:${today}`,
        });
      }
    }
  }
  return sent;
}

/** Escalaties: medewerker en operationeel verantwoordelijke (niveau 2), Jarno alleen bij uitzonderingen (niveau 3). */
async function sendEscalations(decisions: Decision[], people: EscalationPeople, today: string): Promise<number> {
  let sent = 0;
  const toLead = new Map<string, Decision[]>();
  for (const d of decisions) {
    if (!d.finding || !d.escalateTo) continue;
    const f = d.finding;
    if (d.escalateTo === 1) {
      const target = escalationTarget(f.ownerId, people);
      if (!target) continue;
      toLead.set(target, [...(toLead.get(target) ?? []), d]);
      if (f.ownerId) {
        sent += await notify({
          userIds: [f.ownerId], type: "ops_control_escalation", level: "warning",
          title: "Een belangrijke taak is niet tijdig afgerond en staat nu bij de operationeel verantwoordelijke.",
          body: f.clientLabel ? `${f.clientLabel}: ${f.action}` : f.action, href: "/tasks",
          dedupeKey: `opscontrol:esc1:${d.key}:${today}`,
        });
      }
    }
    if (d.notifyJarno && people.jarnoId) {
      sent += await notify({
        userIds: [people.jarnoId], type: "ops_control_jarno", level: "critical",
        title: f.jarnoReason ?? `${f.clientLabel ?? "Klant"}: blijft liggen na escalatie`,
        body: `${f.clientLabel ? `${f.clientLabel}: ` : ""}${f.action}. ${f.jarnoReason ? "" : "De operationeel verantwoordelijke heeft dit nog niet kunnen oplossen."}`.trim(),
        href: f.href ?? "/dashboard",
        dedupeKey: `opscontrol:jarno:${d.key}`,
      });
    }
  }
  for (const [leadId, list] of toLead) {
    const rows = list.map((d) => ({ clientLabel: d.finding!.clientLabel, action: d.finding!.action }));
    sent += await notify({
      userIds: [leadId], type: "ops_control_escalation", level: "warning",
      title: list.length === 1 ? "Een belangrijke taak is niet tijdig afgerond" : `${list.length} belangrijke taken zijn niet tijdig afgerond`,
      body: `${topLines(rows)}. Zorg dat de verantwoordelijke dit vandaag oppakt.`, href: "/dashboard#operationele-controle",
      dedupeKey: `opscontrol:esclead:${leadId}:${today}:${list.map((d) => d.key).sort().join(",").slice(0, 80)}`,
    });
  }
  return sent;
}

/* ------------------------------------------------------------------ *
 * Handmatig naar Jarno (Zone C)
 * ------------------------------------------------------------------ */

export async function escalateItemToJarno(itemId: string, reason: string, byName: string): Promise<void> {
  const [it] = await db.select().from(opsControlItems).where(eq(opsControlItems.id, itemId)).limit(1);
  if (!it) throw new Error("Punt niet gevonden.");
  const people = await resolveEscalationPeople();
  if (!people.jarnoId) throw new Error("Jarno niet gevonden.");
  const now = new Date();
  await db.update(opsControlItems).set({ escalationLevel: 2, jarnoNotifiedAt: now, escalatedAt: it.escalatedAt ?? now, updatedAt: now })
    .where(eq(opsControlItems.id, itemId));
  await notify({
    userIds: [people.jarnoId], type: "ops_control_jarno", level: "critical",
    title: `Besluit nodig: ${it.clientLabel ? `${it.clientLabel}, ` : ""}${it.action}`,
    body: `${byName}: ${reason}`.slice(0, 400), href: it.href ?? "/dashboard",
    dedupeKey: `opscontrol:jarno-handmatig:${itemId}:${now.toISOString().slice(0, 10)}`,
  });
}

/** Laatste runs (voor het dashboard en de instellingen). */
export async function recentRuns(limit = 10) {
  return db.select().from(opsControlRuns).orderBy(sql`${opsControlRuns.startedAt} desc`).limit(limit);
}

export async function runsSince(date: string) {
  return db.select().from(opsControlRuns).where(gte(opsControlRuns.runDate, date));
}
