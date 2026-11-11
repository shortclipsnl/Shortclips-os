import "server-only";
import { and, eq, gte, inArray, isNull, like, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, tasks, users } from "@/db/schema";
import { notify } from "@/server/notifications";
import { activeClientsWhere } from "@/server/client-activity";
import { nlHolidaySet } from "@/lib/holidays";
import { addWorkingDays, snapToWorkingDay } from "@/lib/workdays";
import {
  BATCH_PREFIX, STAP_PREFIX, cijfersDefinitief, defaultControleDag, defaultGoedkeurDag, gecontroleerd, laatsteWerkdag,
  maandNaam, parseStapKey, stapKey, stapTitel, type RapportStap,
} from "@/lib/maandcontrole";
import { periodLabel } from "./analysis";
import { checkReportQuality, type Beoordeling } from "./quality";

/**
 * Maandcontrole: per actieve klant per maand een eigen taak per processtap.
 *
 *  1. controleren  → de projectmanager (anders de operationeel manager) bereidt
 *     de interne en klantversie voor en controleert ze. Is de projectmanager de
 *     eigenaar (Jarno), dan is dit één taak "controleren en goedkeuren".
 *  2. goedkeuren   → de eigenaar, zodra de projectmanager klaar is.
 *  3. versturen    → de projectmanager, na goedkeuring, tot de klantversie in
 *     het klantportaal staat.
 *
 * Eén taak per klant, maand en stap (dedupeKey), nooit dubbel. De taken volgen
 * de status van het rapport: ze sluiten vanzelf als de stap klaar is en gaan
 * weer open als het rapport terug moet. Er gaat nooit iets automatisch naar een
 * klant; goedkeuren en versturen blijven expliciete handelingen.
 */

const IN_PROGRESS = ["gegevens_verzamelen", "analyse_bezig"];
const TE_CONTROLEREN = ["klaar_voor_controle", "aanpassing_nodig"];
const OPEN = ["todo", "in_progress", "blocked"];

const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

function amsterdamDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

/** Wie mag controleren (reports:read) en wie is eigenaar. */
async function controllerPool(): Promise<{ canCheck: Set<string>; fallback: string | null; owners: string[]; names: Map<string, string> }> {
  const res = await db.execute(sql`
    select distinct u.id, u.full_name as name, u.primary_role as role
    from users u
    join user_roles ur on ur.user_id = u.id
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.id = rp.permission_id
    where u.status = 'active' and u.deleted_at is null and u.primary_role <> 'client'
      and p.key = 'reports:read'`);
  const rows = rowsOf<{ id: string; name: string; role: string }>(res);
  const ops = rows.filter((r) => String(r.role) === "operational_manager");
  const owners = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt)))
    .orderBy(users.createdAt);
  return {
    canCheck: new Set(rows.map((r) => r.id)),
    // Klant zonder (bevoegde) projectmanager: de operationeel manager, mits er precies één is.
    fallback: ops.length === 1 ? ops[0]!.id : null,
    owners: owners.map((o) => o.id),
    names: new Map(rows.map((r) => [r.id, r.name])),
  };
}

/** De controleur van een klant: de projectmanager, anders de operationeel manager. */
export function resolveController(coordinatorId: string | null, pool: { canCheck: Set<string>; fallback: string | null }): string | null {
  if (coordinatorId && pool.canCheck.has(coordinatorId)) return coordinatorId;
  return pool.fallback;
}

type ReportState = {
  id: string; clientId: string; clientName: string; period: string; status: string; controller: string | null;
  klaar: boolean; definitief: boolean;
};

/** Alle maandrapporten van de laatste maanden met hun controleur en of ze gecontroleerd zijn. */
async function loadReports(minPeriod: string, pool: Awaited<ReturnType<typeof controllerPool>>): Promise<ReportState[]> {
  const rows = await db
    .select({
      id: clientReports.id, clientId: clientReports.clientId, clientName: clients.name, period: clientReports.period, status: clientReports.status,
      coordinatorId: clients.coordinatorId, analysis: clientReports.analysis, beoordeling: clientReports.beoordeling,
      metrics: clientReports.metrics, ontbrekend: clientReports.ontbrekendeGegevens, generatedAt: clientReports.generatedAt,
    })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .where(and(eq(clientReports.periodType, "month"), isNull(clientReports.deletedAt), activeClientsWhere(), gte(clientReports.period, minPeriod)));
  return rows.map((r) => {
    const b = (r.beoordeling ?? {}) as Beoordeling;
    const beoordeeld = Boolean((b.positief ?? "").trim() && (b.verbeteren ?? "").trim() && (b.volgendeMaand ?? "").trim());
    const openChecks = TE_CONTROLEREN.includes(r.status)
      ? checkReportQuality({
          clientName: r.clientName, analysis: r.analysis as never, beoordeling: b, metrics: (r.metrics ?? {}) as never,
          ontbrekendeGegevens: Array.isArray(r.ontbrekend) ? (r.ontbrekend as string[]) : [],
        }).filter((i) => i.severity === "blok").length
      : 0;
    return {
      id: r.id, clientId: r.clientId, clientName: r.clientName, period: r.period, status: String(r.status),
      controller: resolveController(r.coordinatorId, pool),
      klaar: gecontroleerd({ status: String(r.status), beoordeeld, openChecks }),
      definitief: cijfersDefinitief(r.period, r.generatedAt),
    };
  });
}

/** Gewenste stand van één stap-taak voor een rapport. */
type Wens = { open: boolean; afgerond: boolean; assignee: string | null; status: string; due: string };

/**
 * Bepaalt per stap of de taak open moet staan, afgerond is, of niet (meer)
 * nodig is. Puur, zodat de regels los te testen zijn.
 */
export function gewensteStappen(
  r: Pick<ReportState, "status" | "klaar" | "definitief" | "controller" | "period">,
  eigenaar: string | null,
  today: string,
  holidays?: ReadonlySet<string>,
): Partial<Record<RapportStap, Wens>> {
  const eigen = Boolean(r.controller && eigenaar && r.controller === eigenaar);
  const controleDue = defaultControleDag(r.period, today, holidays);
  const goedkeurDue = defaultGoedkeurDag(r.period, today, holidays);
  const vandaagDue = snapToWorkingDay(today, holidays) === today ? today : addWorkingDays(today, 1, holidays);
  const voorlopig = r.definitief ? "" : " · voorlopige cijfers";
  const out: Partial<Record<RapportStap, Wens>> = {};
  const off = (assignee: string | null, due: string): Wens => ({ open: false, afgerond: false, assignee, status: "", due });
  const done = (assignee: string | null, due: string): Wens => ({ open: false, afgerond: true, assignee, status: "", due });

  if (TE_CONTROLEREN.includes(r.status)) {
    if (!r.klaar) {
      out.controleren = { open: true, afgerond: false, assignee: r.controller, due: controleDue, status: (r.status === "aanpassing_nodig" ? "Aanpassing gevraagd" : "Wacht op controle") + voorlopig };
      if (!eigen) out.goedkeuren = off(eigenaar, goedkeurDue);
    } else if (eigen) {
      // Jarno is zelf projectmanager: één taak tot en met goedkeuren.
      out.controleren = { open: true, afgerond: false, assignee: r.controller, due: controleDue, status: r.definitief ? "Wacht op goedkeuring" : "Gecontroleerd · goedkeuren zodra de definitieve cijfers er zijn" };
    } else {
      out.controleren = done(r.controller, controleDue);
      out.goedkeuren = { open: true, afgerond: false, assignee: eigenaar, due: goedkeurDue, status: r.definitief ? "Wacht op goedkeuring" : "Wacht op definitieve cijfers" };
    }
    out.versturen = off(r.controller, vandaagDue);
  } else if (r.status === "goedgekeurd") {
    out.controleren = done(r.controller, controleDue);
    if (!eigen) out.goedkeuren = done(eigenaar, goedkeurDue);
    out.versturen = { open: true, afgerond: false, assignee: r.controller, due: vandaagDue, status: "Goedgekeurd · klantversie nog versturen" };
  } else if (r.status === "gepubliceerd") {
    out.controleren = done(r.controller, controleDue);
    if (!eigen) out.goedkeuren = done(eigenaar, goedkeurDue);
    out.versturen = done(r.controller, vandaagDue);
  }
  // Wordt (opnieuw) gegenereerd of mislukt: bestaande taken laten staan, niets nieuws.
  return out;
}

export type BatchSyncResult = { created: number; updated: number; closed: number; reopened: number; ready: number; legacyClosed: number };

/**
 * Houdt de taken per klant in lijn met de rapporten. Idempotent: draait na elke
 * generatie, na goedkeuren/versturen/beoordelen en dagelijks om 08:00. Een
 * tweede run maakt nooit een extra taak of melding aan.
 */
export async function syncReportBatches(now = new Date()): Promise<BatchSyncResult> {
  const today = amsterdamDay(now);
  const year = Number(today.slice(0, 4));
  const holidays = nlHolidaySet([year - 1, year, year + 1]);
  const [y, m] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y!, (m ?? 1) - 3, 1));
  const minPeriod = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`;

  const pool = await controllerPool();
  const eigenaar = pool.owners[0] ?? null;
  const reports = await loadReports(minPeriod, pool);
  const out: BatchSyncResult = { created: 0, updated: 0, closed: 0, reopened: 0, ready: 0, legacyClosed: 0 };

  // Bestaande stap-taken (ook afgeronde: één taakregel per klant, maand en stap).
  const existing = await db
    .select({ id: tasks.id, dedupeKey: tasks.dedupeKey, status: tasks.status, description: tasks.description, assigneeId: tasks.assigneeId, title: tasks.title, entityId: tasks.entityId })
    .from(tasks)
    .where(and(like(tasks.dedupeKey, `${STAP_PREFIX}%`), isNull(tasks.deletedAt)));
  const taskByKey = new Map<string, (typeof existing)[number]>();
  for (const t of existing) {
    const cur = taskByKey.get(t.dedupeKey!);
    // Bij meerdere regels met dezelfde sleutel telt een open taak boven een gesloten.
    if (!cur || (OPEN.includes(String(t.status)) && !OPEN.includes(String(cur.status)))) taskByKey.set(t.dedupeKey!, t);
  }

  const unassigned = new Map<string, ReportState[]>();
  for (const r of reports) {
    if (!r.controller && TE_CONTROLEREN.includes(r.status)) {
      unassigned.set(r.period, [...(unassigned.get(r.period) ?? []), r]);
    }
    const wens = gewensteStappen(r, eigenaar, today, holidays);
    const eigen = Boolean(r.controller && eigenaar && r.controller === eigenaar);
    for (const stap of ["controleren", "goedkeuren", "versturen"] as RapportStap[]) {
      const w = wens[stap];
      if (!w) continue;
      const key = stapKey(r.clientId, r.period, stap);
      const task = taskByKey.get(key);
      const title = stapTitel(r.period, stap, eigen);
      if (w.open) {
        if (!w.assignee) continue; // geen verantwoordelijke: melding aan de eigenaar (hieronder)
        if (!task) {
          const [ins] = await db.insert(tasks).values({
            clientId: r.clientId, title, description: w.status, category: "overig", priority: "normal",
            assigneeId: w.assignee, dueOn: w.due, entityType: "client_report", entityId: r.id, source: "automation", dedupeKey: key,
          }).onConflictDoNothing().returning({ id: tasks.id });
          if (ins) {
            out.created++;
            taskByKey.set(key, { id: ins.id, dedupeKey: key, status: "todo", description: w.status, assigneeId: w.assignee, title, entityId: r.id });
          }
        } else {
          const isOpen = OPEN.includes(String(task.status));
          const patch: Record<string, unknown> = {};
          if (!isOpen) { patch.status = "todo"; patch.completedAt = null; patch.archivedAt = null; out.reopened++; }
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
        // Stap klaar (afgerond) of niet meer nodig (geannuleerd, bv. terug naar controle).
        await db.update(tasks).set({ status: w.afgerond ? "done" : "cancelled", completedAt: now, updatedAt: now }).where(eq(tasks.id, task.id));
        out.closed++;
      } else if (task && w.afgerond && String(task.status) === "cancelled") {
        await db.update(tasks).set({ status: "done", completedAt: now, updatedAt: now }).where(eq(tasks.id, task.id));
      }
    }
  }

  // Eén melding per medewerker per maand zodra al zijn rapportages gegenereerd zijn.
  const perController = new Map<string, ReportState[]>();
  for (const r of reports) {
    if (!r.controller) continue;
    const k = `${r.period}|${r.controller}`;
    perController.set(k, [...(perController.get(k) ?? []), r]);
  }
  for (const [k, list] of perController) {
    const [period, userId] = k.split("|") as [string, string];
    const bezig = list.filter((r) => IN_PROGRESS.includes(r.status)).length;
    const open = list.filter((r) => TE_CONTROLEREN.includes(r.status) && !r.klaar);
    if (bezig > 0 || open.length === 0) continue;
    const mislukt = list.filter((r) => r.status === "mislukt");
    const klanten = open.map((r) => r.clientName).sort((a, b) => a.localeCompare(b, "nl"));
    const dag = laatsteWerkdag(period, holidays);
    const n = await notify({
      userIds: [userId],
      type: "report_batch_ready",
      level: "info",
      title: `Maandrapportages ${maandNaam(period)} staan klaar: ${open.length} te controleren`,
      body: `Per klant staat er een taak op je takenlijst: ${klanten.join(", ")}.${mislukt.length ? ` Generatie mislukt: ${mislukt.map((r) => r.clientName).join(", ")}.` : ""} Controledag: ${fmtDag(dag)}.${open.some((r) => !r.definitief) ? " De cijfers zijn nog voorlopig; de definitieve maandcijfers volgen na de laatste dag van de maand." : ""}`,
      href: `/analytics/maandrapportages?weergave=mijn-controle`,
      dedupeKey: `report_batch_ready:${period}:${userId}`,
    }).catch(() => 0);
    if (n > 0) out.ready++;
  }

  // Rapporten zonder controleur: één melding per maand aan de eigenaar.
  for (const [period, list] of unassigned) {
    await notify({
      userIds: pool.owners,
      type: "report_batch_unassigned",
      level: "warning",
      title: `${list.length} maandrapportages ${periodLabel(period)} zonder verantwoordelijke`,
      body: `Wijs bij deze klanten een projectmanager aan, dan krijgt die automatisch de taak: ${list.map((r) => r.clientName).join(", ")}.`,
      href: `/analytics/maandrapportages`,
      dedupeKey: `report_batch_unassigned:${period}`,
    }).catch(() => 0);
  }

  // Oude verzameltaken (één per medewerker per maand) en losse controletaken
  // per klant sluiten: de taken per klant en stap vervangen ze. Geen dubbele taken.
  const legacy = await db
    .update(tasks)
    .set({ status: "cancelled", completedAt: now, updatedAt: now })
    .where(and(
      or(like(tasks.dedupeKey, `${BATCH_PREFIX}%`), like(tasks.dedupeKey, "report_review:%")),
      eq(tasks.source, "automation"), inArray(tasks.status, ["todo", "in_progress", "blocked"]), isNull(tasks.deletedAt),
    ))
    .returning({ id: tasks.id });
  out.legacyClosed = legacy.length;

  return out;
}

function fmtDag(d: string): string {
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/* ------------------------------------------------------------------ *
 * Voor de pagina Maandrapportages
 * ------------------------------------------------------------------ */

export type StapTaakInfo = { taskId: string; clientId: string; period: string; stap: RapportStap; dueOn: string | null; status: string; assigneeId: string | null };

/** De stap-taken per klant en maand (voor de fase in de tabel). */
export async function listStepTasks(): Promise<StapTaakInfo[]> {
  const rows = await db
    .select({ id: tasks.id, dedupeKey: tasks.dedupeKey, dueOn: tasks.dueOn, status: tasks.status, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(and(like(tasks.dedupeKey, `${STAP_PREFIX}%`), isNull(tasks.deletedAt)));
  return rows.flatMap((r) => {
    const p = parseStapKey(r.dedupeKey);
    if (!p || r.status === "cancelled") return [];
    const due = r.dueOn ? String(r.dueOn).slice(0, 10) : null;
    return [{ taskId: r.id, clientId: p.clientId, period: p.period, stap: p.stap, dueOn: due, status: String(r.status), assigneeId: r.assigneeId }];
  });
}

/** Controleur per rapport (zelfde regel als de taken), voor de fase in de tabel. */
export async function controllersFor(rows: Array<{ id: string; pmId: string | null }>): Promise<Map<string, string | null>> {
  const pool = await controllerPool();
  return new Map(rows.map((r) => [r.id, resolveController(r.pmId, pool)]));
}
