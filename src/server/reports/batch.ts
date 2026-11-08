import "server-only";
import { and, eq, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, tasks, users } from "@/db/schema";
import { notify } from "@/server/notifications";
import { activeClientsWhere } from "@/server/client-activity";
import { nlHolidaySet } from "@/lib/holidays";
import { addWorkingDays } from "@/lib/workdays";
import {
  BATCH_PREFIX, batchHref, batchKey, defaultControleDag, gecontroleerd, parseBatchKey, voortgangTekst,
} from "@/lib/maandcontrole";
import { periodLabel } from "./analysis";
import { checkReportQuality, type Beoordeling } from "./quality";

/**
 * Maandcontrole: per medewerker per maand één controletaak, één melding
 * "staan klaar" en hooguit één herinnering. Vervangt de losse melding en taak
 * per klant. Goedkeuren en publiceren blijven precies zoals ze waren: er gaat
 * nooit iets automatisch naar een klant.
 */

const IN_PROGRESS = ["gegevens_verzamelen", "analyse_bezig"];
const TE_CONTROLEREN = ["klaar_voor_controle", "aanpassing_nodig"];

const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

function amsterdamToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
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
    .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt)));
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
  id: string; clientName: string; period: string; status: string; controller: string | null;
  klaar: boolean;
};

/** Alle maandrapporten van de laatste maanden met hun controleur en of ze gecontroleerd zijn. */
async function loadReports(minPeriod: string, pool: Awaited<ReturnType<typeof controllerPool>>): Promise<ReportState[]> {
  const rows = await db
    .select({
      id: clientReports.id, clientName: clients.name, period: clientReports.period, status: clientReports.status,
      coordinatorId: clients.coordinatorId, analysis: clientReports.analysis, beoordeling: clientReports.beoordeling,
      metrics: clientReports.metrics, ontbrekend: clientReports.ontbrekendeGegevens,
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
      id: r.id, clientName: r.clientName, period: r.period, status: String(r.status),
      controller: resolveController(r.coordinatorId, pool),
      klaar: gecontroleerd({ status: String(r.status), beoordeeld, openChecks }),
    };
  });
}

export type BatchSyncResult = { created: number; updated: number; closed: number; ready: number; reminded: number; approve: number; legacyClosed: number };

/**
 * Houdt de maandtaken in lijn met de rapporten. Idempotent: draait na elke
 * generatie (wachtrij) en dagelijks om 08:00. Een tweede run maakt nooit een
 * extra taak of melding aan.
 */
export async function syncReportBatches(now = new Date()): Promise<BatchSyncResult> {
  const today = amsterdamToday(now);
  const holidays = nlHolidaySet([Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]);
  const [y, m] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y!, (m ?? 1) - 3, 1));
  const minPeriod = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`;

  const pool = await controllerPool();
  const reports = await loadReports(minPeriod, pool);
  const out: BatchSyncResult = { created: 0, updated: 0, closed: 0, ready: 0, reminded: 0, approve: 0, legacyClosed: 0 };

  // Groeperen per maand + controleur.
  const groups = new Map<string, ReportState[]>();
  const unassigned = new Map<string, ReportState[]>();
  for (const r of reports) {
    if (!r.controller) {
      if (TE_CONTROLEREN.includes(r.status)) unassigned.set(r.period, [...(unassigned.get(r.period) ?? []), r]);
      continue;
    }
    const k = `${r.period}|${r.controller}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const existing = await db
    .select({ id: tasks.id, dedupeKey: tasks.dedupeKey, status: tasks.status, dueOn: tasks.dueOn, createdAt: tasks.createdAt, description: tasks.description, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(and(like(tasks.dedupeKey, `${BATCH_PREFIX}%`), isNull(tasks.deletedAt)));
  const taskByKey = new Map(existing.map((t) => [t.dedupeKey!, t]));

  for (const [k, list] of groups) {
    const [period, userId] = k.split("|") as [string, string];
    const key = batchKey(period, userId);
    const maand = periodLabel(period);
    const relevant = list.filter((r) => r.status !== "mislukt");
    const gegenereerd = relevant.filter((r) => !IN_PROGRESS.includes(r.status));
    const open = gegenereerd.filter((r) => TE_CONTROLEREN.includes(r.status) && !r.klaar);
    const klaar = gegenereerd.filter((r) => r.klaar);
    const bezig = relevant.filter((r) => IN_PROGRESS.includes(r.status)).length;
    const mislukt = list.filter((r) => r.status === "mislukt");
    const wachtGoedkeuring = gegenereerd.filter((r) => TE_CONTROLEREN.includes(r.status) && r.klaar);
    const task = taskByKey.get(key);

    const description = [
      `${voortgangTekst(klaar.length, gegenereerd.length)}, ${open.length} nog te controleren.`,
      open.length ? `Open: ${open.map((r) => r.clientName).sort((a, b) => a.localeCompare(b, "nl")).join(", ")}.` : null,
      bezig ? `${bezig} worden nog gegenereerd.` : null,
      mislukt.length ? `Generatie mislukt (niet meegeteld): ${mislukt.map((r) => r.clientName).join(", ")}.` : null,
      "Controleer per klant de interne versie en de klantversie, vul de beoordeling in en zet hem klaar voor goedkeuring. Er gaat niets naar de klant zonder goedkeuring.",
    ].filter(Boolean).join("\n");

    if (!task) {
      // Alleen een taak als er echt iets te controleren is (geen taak voor een maand die al rond is).
      if (open.length === 0) continue;
      const [ins] = await db.insert(tasks).values({
        title: `Maandrapportages controleren en afronden (${maand})`,
        description,
        category: "overig",
        priority: "normal",
        assigneeId: userId,
        dueOn: defaultControleDag(period, today, holidays),
        entityType: "report_batch",
        source: "automation",
        dedupeKey: key,
      }).onConflictDoNothing().returning({ id: tasks.id, createdAt: tasks.createdAt });
      if (ins) {
        out.created++;
        taskByKey.set(key, { id: ins.id, dedupeKey: key, status: "todo", dueOn: defaultControleDag(period, today, holidays), createdAt: ins.createdAt, description, assigneeId: userId });
      }
    } else {
      const done = task.status === "done";
      if (!done && open.length === 0 && bezig === 0) {
        await db.update(tasks).set({ status: "done", completedAt: now, description, updatedAt: now }).where(eq(tasks.id, task.id));
        out.closed++;
      } else if (done && open.length > 0) {
        // Rapport is opnieuw open gezet (bv. aanpassing gevraagd): taak weer open.
        await db.update(tasks).set({ status: "todo", completedAt: null, description, updatedAt: now }).where(eq(tasks.id, task.id));
        out.updated++;
      } else if (task.description !== description && task.status !== "cancelled") {
        await db.update(tasks).set({ description, updatedAt: now }).where(eq(tasks.id, task.id));
        out.updated++;
      }
    }

    const current = taskByKey.get(key);
    const naam = maand.split(" ")[0];

    // 1) Eén melding "staan klaar", zodra alles voor deze persoon gegenereerd is.
    if (current && bezig === 0 && open.length > 0) {
      const klanten = open.map((r) => r.clientName).sort((a, b) => a.localeCompare(b, "nl"));
      const n = await notify({
        userIds: [userId],
        type: "report_batch_ready",
        level: "info",
        title: `Maandrapportages ${naam} staan klaar: ${gegenereerd.length} ${gegenereerd.length === 1 ? "klant" : "klanten"}, ${open.length} te controleren`,
        body: `Nog te controleren: ${klanten.join(", ")}.${mislukt.length ? ` Generatie mislukt (niet meegeteld): ${mislukt.map((r) => r.clientName).join(", ")}.` : ""} Je controledag staat op ${fmtDag(current.dueOn)}; je kunt die op de pagina Maandrapportages wijzigen.`,
        href: batchHref(period),
        entityType: "task",
        entityId: current.id,
        dedupeKey: `report_batch_ready:${period}:${userId}`,
      }).catch(() => 0);
      if (n > 0) out.ready++;
    }

    // 2) Herinnering (maximaal één): taak open zonder controledag, al een werkdag oud.
    if (current && current.status !== "done" && !current.dueOn && open.length > 0) {
      const created = current.createdAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
      if (addWorkingDays(created, 1, holidays) <= today) {
        const n = await notify({
          userIds: [userId],
          type: "report_batch_unplanned",
          level: "warning",
          title: `Plan je controledag voor de maandrapportages van ${naam}`,
          body: `Er staan nog ${open.length} maandrapportages open en er is geen controledag ingepland.`,
          href: batchHref(period),
          entityType: "task",
          entityId: current.id,
          dedupeKey: `report_batch_unplanned:${period}:${userId}`,
        }).catch(() => 0);
        if (n > 0) out.reminded++;
      }
    }

    // 3) Alles gecontroleerd: één gebundelde melding aan de goedkeurder(s).
    //    Niet als de controleur zelf eigenaar is (die keurt direct goed).
    if (open.length === 0 && bezig === 0 && wachtGoedkeuring.length > 0 && !pool.owners.includes(userId)) {
      const wie = pool.names.get(userId) ?? "De controleur";
      const n = await notify({
        userIds: pool.owners,
        type: "report_batch_approve",
        level: "info",
        title: `Maandrapportages ${naam} klaar voor goedkeuring (${wachtGoedkeuring.length})`,
        body: `${wie} heeft de maandrapportages van ${maand} gecontroleerd. Keur ze goed en publiceer ze naar het klantportaal.`,
        href: `/analytics/maandrapportages?maand=${period}&status=controleren`,
        dedupeKey: `report_batch_approve:${period}:${userId}`,
      }).catch(() => 0);
      if (n > 0) out.approve++;
    }
  }

  // Rapporten zonder controleur: één melding per maand aan de eigenaar.
  for (const [period, list] of unassigned) {
    await notify({
      userIds: pool.owners,
      type: "report_batch_unassigned",
      level: "warning",
      title: `${list.length} maandrapportages ${periodLabel(period)} zonder verantwoordelijke`,
      body: `Wijs bij deze klanten een projectmanager aan, dan komen ze automatisch in diens controletaak: ${list.map((r) => r.clientName).join(", ")}.`,
      href: `/analytics/maandrapportages?maand=${period}`,
      dedupeKey: `report_batch_unassigned:${period}`,
    }).catch(() => 0);
  }

  // Oude losse controletaken per klant (vóór de maandtaak) sluiten: geen dubbele taken.
  const legacy = await db
    .update(tasks)
    .set({ status: "cancelled", completedAt: now, updatedAt: now })
    .where(and(like(tasks.dedupeKey, "report_review:%"), eq(tasks.source, "automation"), inArray(tasks.status, ["todo", "in_progress", "blocked"]), isNull(tasks.deletedAt)))
    .returning({ id: tasks.id });
  out.legacyClosed = legacy.length;

  return out;
}

function fmtDag(d: string | Date | null): string {
  if (!d) return "nog niet ingepland";
  const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  return new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/* ------------------------------------------------------------------ *
 * Voor de pagina Maandrapportages
 * ------------------------------------------------------------------ */

export type BatchInfo = { taskId: string; period: string; userId: string; name: string; dueOn: string | null; status: string };

/** Alle maandtaken (eigenaar ziet alles, anderen hun eigen). */
export async function listBatches(viewerId: string, all: boolean): Promise<BatchInfo[]> {
  const rows = await db
    .select({ id: tasks.id, dedupeKey: tasks.dedupeKey, dueOn: tasks.dueOn, status: tasks.status, assigneeId: tasks.assigneeId, name: users.fullName })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(like(tasks.dedupeKey, `${BATCH_PREFIX}%`), isNull(tasks.deletedAt), all ? undefined : eq(tasks.assigneeId, viewerId)));
  return rows.flatMap((r) => {
    const p = parseBatchKey(r.dedupeKey);
    if (!p || r.status === "cancelled") return [];
    const due = r.dueOn ? String(r.dueOn).slice(0, 10) : null;
    return [{ taskId: r.id, period: p.period, userId: p.userId, name: r.name ?? "Onbekend", dueOn: due, status: String(r.status) }];
  });
}

/** Controleur per rapport (zelfde regel als de taken), voor de fase in de tabel. */
export async function controllersFor(rows: Array<{ id: string; pmId: string | null }>): Promise<Map<string, string | null>> {
  const pool = await controllerPool();
  return new Map(rows.map((r) => [r.id, resolveController(r.pmId, pool)]));
}
