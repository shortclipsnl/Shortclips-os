import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, like, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientQuarterSettings, clients, quarterlyReportEvents, quarterlyReports, tasks, users } from "@/db/schema";
import { activeClientsWhere, notInactiveClient } from "@/server/client-activity";
import { notify } from "@/server/notifications";
import { addWorkingDays, snapToWorkingDay } from "@/lib/workdays";
import {
  QUARTER_STAPPEN, QUARTER_TASK_PREFIX, gewensteKwartaalTaken, isAchterstallig, kortDatum, quarterFromKey, quarterOf, quarterPhase,
  quarterSchedule, quarterTaskKey, quarterTaskTitle, type QuarterMode, type QuarterStap, type QuarterStatus,
} from "@/lib/kwartaal";
import { amsterdamToday, ensureQuarterRow, generateQuarterReport, holidaysAround, logQuarterEvent } from "./run";
import { errorForViewer } from "@/lib/team-error";

/**
 * Automatische kwartaalplanning.
 *
 *  - Dag 1 van de derde maand: de rapportagetaak staat bij de verantwoordelijke.
 *  - Halverwege de derde maand: een voorlopig intern concept met de cijfers tot dan.
 *  - Laatste week: controle op ontbrekende gegevens, concept ververst.
 *  - Na afloop: de volledige cijfers ophalen; ontbreken die, dan wachten.
 *  - Uiterlijk vijf werkdagen na afloop klaar voor controle, zeven voor publicatie.
 *
 * Alles is idempotent: een tweede run op dezelfde dag verandert niets en maakt
 * nooit een tweede rapportage, taak of melding. Er gaat nooit iets automatisch
 * naar een klant; goedkeuren en publiceren blijven handelingen van een mens.
 */

const OPEN = ["todo", "in_progress", "blocked"];
const STALE_MIN = 20;
const BUDGET_MS = 110_000;
const MAX_ATTEMPTS = 3;
const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

/* ------------------------------------------------------------------ *
 * Wie controleert en wie keurt goed
 * ------------------------------------------------------------------ */

export type QuarterPeople = { canCheck: Set<string>; fallback: string | null; approver: string | null; owners: string[]; names: Map<string, string> };

export async function quarterPeople(): Promise<QuarterPeople> {
  const res = await db.execute(sql`
    select distinct u.id, u.full_name as name, u.primary_role as role, p.key
    from users u
    join user_roles ur on ur.user_id = u.id
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.id = rp.permission_id
    where u.status = 'active' and u.deleted_at is null and u.primary_role <> 'client'
      and p.key in ('reports:read', 'reports:approve')`);
  const rows = rowsOf<{ id: string; name: string; role: string; key: string }>(res);
  const owners = await db.select({ id: users.id, name: users.fullName }).from(users)
    .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt))).orderBy(users.createdAt);
  const checkers = rows.filter((r) => r.key === "reports:read");
  const ops = checkers.filter((r) => String(r.role) === "operational_manager");
  const approvers = rows.filter((r) => r.key === "reports:approve" && String(r.role) !== "owner" && String(r.role) !== "admin");
  const names = new Map<string, string>([...rows.map((r) => [r.id, r.name] as [string, string]), ...owners.map((o) => [o.id, o.name] as [string, string])]);
  return {
    canCheck: new Set(checkers.map((r) => r.id)),
    fallback: ops.length === 1 ? ops[0]!.id : null,
    // Goedkeuren: de eigenaar, tenzij het recht bewust aan precies één ander teamlid is gegeven.
    approver: approvers.length === 1 ? approvers[0]!.id : (owners[0]?.id ?? null),
    owners: owners.map((o) => o.id),
    names,
  };
}

/** De verantwoordelijke van een klant: de projectmanager, anders de operationeel manager. */
export function quarterController(coordinatorId: string | null, p: Pick<QuarterPeople, "canCheck" | "fallback">): string | null {
  if (coordinatorId && p.canCheck.has(coordinatorId)) return coordinatorId;
  return p.fallback;
}

/* ------------------------------------------------------------------ *
 * Dagelijkse planner
 * ------------------------------------------------------------------ */

export type PlannerResult = { clients: number; created: number; voorbereiding: number; queuedVoorlopig: number; queuedDefinitief: number; tasks: TaskSyncResult };

export async function runQuarterlyPlanner(now = new Date()): Promise<PlannerResult> {
  const today = amsterdamToday(now);
  const out: PlannerResult = { clients: 0, created: 0, voorbereiding: 0, queuedVoorlopig: 0, queuedDefinitief: 0, tasks: { created: 0, updated: 0, closed: 0, reopened: 0 } };

  const active = await db
    .select({ id: clients.id, startedOn: clients.startedOn, mode: clientQuarterSettings.mode, enabled: clientQuarterSettings.enabled })
    .from(clients)
    .leftJoin(clientQuarterSettings, eq(clientQuarterSettings.clientId, clients.id))
    .where(and(activeClientsWhere(), eq(clients.showInResults, true)))
    .limit(1000);

  for (const c of active) {
    if (c.enabled === false) continue;
    const startedOn = c.startedOn ? String(c.startedOn).slice(0, 10) : null;
    // Samenwerking nog niet begonnen: nog geen kwartaal.
    if (startedOn && startedOn > today) continue;
    out.clients++;
    const mode: QuarterMode = c.mode === "contract" ? "contract" : "kalender";
    const q = quarterOf(mode, startedOn, today);
    const row = await ensureQuarterRow(c.id, q);
    if (row.created) out.created++;

    const [r] = await db.select({ id: quarterlyReports.id, status: quarterlyReports.status, generatedAt: quarterlyReports.generatedAt, queued: quarterlyReports.queued })
      .from(quarterlyReports).where(eq(quarterlyReports.id, row.id)).limit(1);
    if (!r) continue;
    const phase = quarterPhase(q, today);
    const sched = quarterSchedule(q);

    // Dag 1 van de derde maand: de voorbereiding start (taak volgt uit de status).
    if (r.status === "gepland" && phase !== "lopend") {
      await db.update(quarterlyReports).set({ status: "in_voorbereiding", updatedAt: new Date() }).where(eq(quarterlyReports.id, r.id));
      await logQuarterEvent({ reportId: r.id, clientId: c.id, type: "voorbereiding_gestart", from: "gepland", to: "in_voorbereiding", note: `Het kwartaal loopt af op ${kortDatum(q.to)}. De rapportagetaak staat bij de verantwoordelijke.` });
      r.status = "in_voorbereiding";
      out.voorbereiding++;
    }
    // Halverwege de derde maand: voorlopig concept. In de laatste week: één keer verversen.
    const generatedDay = r.generatedAt ? amsterdamToday(r.generatedAt) : null;
    const conceptNodig = (phase === "concept" || phase === "laatste_week") && r.status === "in_voorbereiding" && !generatedDay;
    const verversen = phase === "laatste_week" && r.status === "concept_gegenereerd" && generatedDay !== null && generatedDay < sched.laatsteWeek;
    if ((conceptNodig || verversen) && !r.queued) {
      await db.update(quarterlyReports).set({ queued: "voorlopig", updatedAt: new Date() }).where(eq(quarterlyReports.id, r.id));
      out.queuedVoorlopig++;
    }
  }

  // Afgelopen kwartalen die nog niet definitief zijn: de volledige cijfers ophalen.
  // Wacht de rapportage op data, dan wordt er elke dag opnieuw gekeken.
  const afgelopen = await db
    .update(quarterlyReports)
    .set({ queued: "definitief", updatedAt: new Date() })
    .where(and(
      isNull(quarterlyReports.deletedAt), isNull(quarterlyReports.queued), isNull(quarterlyReports.startedAt),
      lt(quarterlyReports.periodEnd, today),
      inArray(quarterlyReports.status, ["gepland", "in_voorbereiding", "concept_gegenereerd", "wachten_op_data"]),
      isNull(quarterlyReports.dataOverrideAt),
      notInactiveClient(quarterlyReports.clientId),
    ))
    .returning({ id: quarterlyReports.id });
  out.queuedDefinitief = afgelopen.length;

  out.tasks = await syncQuarterlyTasks(now);
  return out;
}

/* ------------------------------------------------------------------ *
 * Wachtrij: de generaties zelf (met tijdsbudget, nooit dubbel)
 * ------------------------------------------------------------------ */

export async function runQuarterlyQueue(): Promise<{ queued: number; processed: number; ok: number; waiting: number; failed: number }> {
  const started = Date.now();
  const staleBefore = new Date(Date.now() - STALE_MIN * 60000);
  const queue = await db
    .select({ id: quarterlyReports.id, clientId: quarterlyReports.clientId, attempts: quarterlyReports.attempts, status: quarterlyReports.status })
    .from(quarterlyReports)
    .where(and(
      isNull(quarterlyReports.deletedAt), isNotNull(quarterlyReports.queued),
      or(isNull(quarterlyReports.startedAt), lt(quarterlyReports.startedAt, staleBefore)),
      notInactiveClient(quarterlyReports.clientId),
    ))
    .orderBy(asc(quarterlyReports.updatedAt))
    .limit(40);

  let processed = 0, ok = 0, waiting = 0, failed = 0;
  for (const r of queue) {
    if (Date.now() - started > BUDGET_MS) break;
    if (r.attempts >= MAX_ATTEMPTS) {
      // Niet eindeloos opnieuw proberen: uit de wachtrij, de fout blijft zichtbaar.
      await db.update(quarterlyReports).set({ queued: null, startedAt: null, updatedAt: new Date() }).where(eq(quarterlyReports.id, r.id));
      failed++;
      continue;
    }
    processed++;
    const res = await generateQuarterReport(r.id, { force: true }).catch((e) => ({ ok: false as const, reason: "error" as const, message: String(e) }));
    if (res.ok) ok++;
    else if (res.reason === "wachten_op_data") {
      // Morgen kijkt de planner opnieuw; vandaag niet blijven proberen.
      await db.update(quarterlyReports).set({ queued: null, updatedAt: new Date() }).where(eq(quarterlyReports.id, r.id));
      waiting++;
    } else failed++;
  }
  if (processed > 0) await syncQuarterlyTasks().catch(() => undefined);
  return { queued: queue.length, processed, ok, waiting, failed };
}

/* ------------------------------------------------------------------ *
 * Taken per klant per processtap (bestaande takenpagina)
 * ------------------------------------------------------------------ */

export type TaskSyncResult = { created: number; updated: number; closed: number; reopened: number };

export async function syncQuarterlyTasks(now = new Date()): Promise<TaskSyncResult> {
  const today = amsterdamToday(now);
  const holidays = holidaysAround(today);
  const people = await quarterPeople();
  const out: TaskSyncResult = { created: 0, updated: 0, closed: 0, reopened: 0 };
  // Alleen recente kwartalen: oude restjes vervuilen de takenlijst niet.
  const [y, m] = today.split("-").map(Number);
  const minEnd = new Date(Date.UTC(y!, m! - 1 - 7, 1)).toISOString().slice(0, 10);

  const reports = await db
    .select({
      id: quarterlyReports.id, clientId: quarterlyReports.clientId, periodKey: quarterlyReports.periodKey, status: quarterlyReports.status,
      reviewedAt: quarterlyReports.reviewedAt, coordinatorId: clients.coordinatorId, startedOn: clients.startedOn,
    })
    .from(quarterlyReports)
    .innerJoin(clients, eq(clients.id, quarterlyReports.clientId))
    .where(and(isNull(quarterlyReports.deletedAt), activeClientsWhere(), gte(quarterlyReports.periodEnd, minEnd)));

  const existing = await db
    .select({ id: tasks.id, dedupeKey: tasks.dedupeKey, status: tasks.status, description: tasks.description, assigneeId: tasks.assigneeId, title: tasks.title, entityId: tasks.entityId, dueOn: tasks.dueOn })
    .from(tasks)
    .where(and(like(tasks.dedupeKey, `${QUARTER_TASK_PREFIX}%`), isNull(tasks.deletedAt)));
  const byKey = new Map<string, (typeof existing)[number]>();
  for (const t of existing) {
    const cur = byKey.get(t.dedupeKey!);
    if (!cur || (OPEN.includes(String(t.status)) && !OPEN.includes(String(cur.status)))) byKey.set(t.dedupeKey!, t);
  }

  for (const r of reports) {
    const q = quarterFromKey(r.periodKey, r.startedOn ? String(r.startedOn).slice(0, 10) : null);
    if (!q) continue;
    const controller = quarterController(r.coordinatorId, people);
    const eigen = Boolean(controller && people.approver && controller === people.approver);
    const wens = gewensteKwartaalTaken({ status: r.status as QuarterStatus, controller, gecontroleerd: Boolean(r.reviewedAt) }, q, people.approver, holidays);
    for (const stap of QUARTER_STAPPEN as QuarterStap[]) {
      const w = wens[stap];
      if (!w) continue;
      const key = quarterTaskKey(r.clientId, r.periodKey, stap);
      const task = byKey.get(key);
      const title = quarterTaskTitle(q.label, stap, eigen);
      // Een deadline hoort op een werkdag; een verstreken deadline blijft staan (taak is dan te laat).
      const due = snapToWorkingDay(w.due, holidays);
      if (w.open) {
        if (!w.assignee) continue; // geen verantwoordelijke: de eigenaar krijgt dit in het dagoverzicht
        if (!task) {
          const [ins] = await db.insert(tasks).values({
            clientId: r.clientId, title, description: w.status, category: "overig", priority: "normal", assigneeId: w.assignee,
            dueOn: due, entityType: "quarterly_report", entityId: r.id, source: "automation", dedupeKey: key,
          }).onConflictDoNothing().returning({ id: tasks.id });
          if (ins) { out.created++; byKey.set(key, { id: ins.id, dedupeKey: key, status: "todo", description: w.status, assigneeId: w.assignee, title, entityId: r.id, dueOn: due }); }
        } else {
          const isOpen = OPEN.includes(String(task.status));
          const patch: Record<string, unknown> = {};
          if (!isOpen) { patch.status = "todo"; patch.completedAt = null; patch.archivedAt = null; patch.dueOn = due; out.reopened++; }
          if (task.description !== w.status) patch.description = w.status;
          if (task.assigneeId !== w.assignee) patch.assigneeId = w.assignee;
          if (task.title !== title) patch.title = title;
          if (task.entityId !== r.id) patch.entityId = r.id;
          if (Object.keys(patch).length) {
            await db.update(tasks).set({ ...patch, updatedAt: now }).where(eq(tasks.id, task.id));
            if (isOpen) out.updated++;
          }
        }
      } else if (task && OPEN.includes(String(task.status))) {
        await db.update(tasks).set({ status: w.afgerond ? "done" : "cancelled", completedAt: now, updatedAt: now }).where(eq(tasks.id, task.id));
        out.closed++;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Eén dagoverzicht per medewerker (geen losse meldingen per klant)
 * ------------------------------------------------------------------ */

type DigestLine = { soort: string; tekst: string };

/**
 * Bundelt alles wat er rond kwartaalrapportages speelt in één melding per
 * medewerker per werkdag. Alleen als er iets nieuws is (gebeurtenissen van de
 * afgelopen dag) of een deadline binnen twee werkdagen ligt of net is verstreken.
 * Draait als eigen job aan het begin van de werkdag, na de planner en de eerste
 * generaties; wat later op de dag klaarkomt staat in het overzicht van morgen.
 */
export async function sendQuarterlyDigest(now = new Date()): Promise<number> {
  const today = amsterdamToday(now);
  const holidays = holidaysAround(today);
  if (snapToWorkingDay(today, holidays) !== today) return 0; // alleen op werkdagen
  const people = await quarterPeople();
  const sinds = new Date(now.getTime() - 26 * 3600_000);

  const reports = await db
    .select({
      id: quarterlyReports.id, clientId: quarterlyReports.clientId, clientName: clients.name, periodKey: quarterlyReports.periodKey, status: quarterlyReports.status,
      reviewedAt: quarterlyReports.reviewedAt, coordinatorId: clients.coordinatorId, startedOn: clients.startedOn, ontbrekend: quarterlyReports.ontbrekend,
      wachtReden: quarterlyReports.wachtReden, errorMessage: quarterlyReports.errorMessage,
    })
    .from(quarterlyReports)
    .innerJoin(clients, eq(clients.id, quarterlyReports.clientId))
    .where(and(isNull(quarterlyReports.deletedAt), activeClientsWhere(), sql`${quarterlyReports.status} <> 'gepland'`));
  if (reports.length === 0) return 0;
  const events = await db
    .select({ reportId: quarterlyReportEvents.reportId, type: quarterlyReportEvents.type })
    .from(quarterlyReportEvents)
    .where(and(gte(quarterlyReportEvents.createdAt, sinds), inArray(quarterlyReportEvents.reportId, reports.map((r) => r.id))));
  const evBy = new Map<string, Set<string>>();
  for (const e of events) evBy.set(e.reportId, new Set([...(evBy.get(e.reportId) ?? []), e.type]));

  const perUser = new Map<string, DigestLine[]>();
  const add = (userId: string | null, line: DigestLine) => { if (userId) perUser.set(userId, [...(perUser.get(userId) ?? []), line]); };
  const zonderVerantwoordelijke: string[] = [];

  for (const r of reports) {
    const q = quarterFromKey(r.periodKey, r.startedOn ? String(r.startedOn).slice(0, 10) : null);
    if (!q) continue;
    const controller = quarterController(r.coordinatorId, people);
    const s = quarterSchedule(q, holidays);
    const ev = evBy.get(r.id) ?? new Set<string>();
    const naam = `${r.clientName} (${q.label})`;
    const status = r.status as QuarterStatus;
    if (!controller && status !== "gepubliceerd") zonderVerantwoordelijke.push(r.clientName);

    if (ev.has("voorbereiding_gestart")) add(controller, { soort: "Voorbereiden", tekst: naam });
    if (ev.has("concept_gegenereerd")) add(controller, { soort: "Voorlopig concept klaar voor controle", tekst: naam });
    if (ev.has("definitief_gegenereerd")) add(controller, { soort: "Definitieve rapportage beschikbaar", tekst: naam });
    if (ev.has("wachten_op_data")) add(controller, { soort: "Ontbrekende gegevens", tekst: `${naam}: ${r.wachtReden ?? "nog niet alle cijfers binnen"}` });
    if (ev.has("generatie_mislukt")) add(controller, { soort: "Genereren mislukt", tekst: `${naam}: ${errorForViewer(false, r.errorMessage) ?? "probeer het opnieuw"}` });
    if (ev.has("controle_afgerond") && people.approver !== controller) add(people.approver, { soort: "Wacht op goedkeuring", tekst: naam });
    if (ev.has("aanpassingen_gevraagd")) add(controller, { soort: "Aanpassingen gevraagd", tekst: naam });
    if (ev.has("goedgekeurd")) add(controller, { soort: "Goedgekeurd, nog publiceren", tekst: naam });
    if (ev.has("gepubliceerd")) for (const o of people.owners) add(o, { soort: "Gepubliceerd in het klantportaal", tekst: naam });

    // Laatste week van het kwartaal: één keer melden wat er nog ontbreekt.
    const ontbreekt = Array.isArray(r.ontbrekend) ? (r.ontbrekend as string[]) : [];
    if (today === snapToWorkingDay(s.laatsteWeek, holidays) && today <= q.to) {
      add(controller, { soort: "Kwartaal bijna afgelopen", tekst: `${naam}, eindigt ${kortDatum(q.to)}${ontbreekt.length ? `. Ontbreekt: ${ontbreekt.slice(0, 2).join(" ")}` : ""}` });
    }
    // Deadlines: twee werkdagen vooraf, en de eerste werkdag nadat ze verstreken zijn.
    if (status === "goedgekeurd") {
      if (addWorkingDays(today, 2, holidays) === s.publicatieDeadline) add(controller, { soort: "Publicatiedeadline nadert", tekst: `${naam}, uiterlijk ${kortDatum(s.publicatieDeadline)}` });
      if (addWorkingDays(s.publicatieDeadline, 1, holidays) === today) add(controller, { soort: "Achterstallig", tekst: `${naam}: publicatie had er op ${kortDatum(s.publicatieDeadline)} moeten staan` });
    } else if (status !== "gepubliceerd" && isAchterstallig({ status }, q, today, holidays) && addWorkingDays(s.controleDeadline, 1, holidays) === today) {
      const wie = status === "klaar_voor_controle" && r.reviewedAt ? people.approver : controller;
      add(wie, { soort: "Achterstallig", tekst: `${naam}: de interne controle had op ${kortDatum(s.controleDeadline)} klaar moeten zijn` });
    }
  }
  if (zonderVerantwoordelijke.length) {
    const uniek = [...new Set(zonderVerantwoordelijke)];
    // Hooguit één keer per week (maandag) herinneren aan klanten zonder verantwoordelijke.
    if (new Date(`${today}T12:00:00Z`).getUTCDay() === 1) for (const o of people.owners) add(o, { soort: "Geen verantwoordelijke", tekst: `Wijs een projectmanager toe bij: ${uniek.join(", ")}` });
  }

  let sent = 0;
  for (const [userId, lines] of perUser) {
    const groepen = new Map<string, string[]>();
    for (const l of lines) groepen.set(l.soort, [...(groepen.get(l.soort) ?? []), l.tekst]);
    const body = [...groepen.entries()].map(([soort, items]) => `${soort}: ${[...new Set(items)].join("; ")}.`).join("\n");
    const n = await notify({
      userIds: [userId], type: "quarter_report_digest", level: lines.some((l) => l.soort === "Achterstallig" || l.soort === "Genereren mislukt") ? "warning" : "info",
      title: `Kwartaalrapportages: ${lines.length} ${lines.length === 1 ? "punt" : "punten"} voor vandaag`, body,
      href: "/analytics/kwartaalrapportages?weergave=mijn", dedupeKey: `quarter_report_digest:${today}:${userId}`,
    }).catch(() => 0);
    if (n > 0) sent++;
  }
  return sent;
}
