import "server-only";
import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, monthlyReportReads, scripts } from "@/db/schema";
import { notify } from "@/server/notifications";
import { getStringSetting } from "@/server/app-settings";
import { periodLabel } from "./analysis";
import { shiftPeriod } from "./metrics";
import { APPROVED_STATUSES, listReportTeam } from "./service";

/** Na hoeveel dagen zonder doornemen een herinnering volgt (en daarna opnieuw). */
export const REMINDER_AFTER_DAYS = 3;

/** Instelling met vaste lezers van alle maandrapportages (komma-gescheiden user-id's). */
export const EXTRA_READERS_KEY = "reports.extra_readers";

async function extraReaders(): Promise<string[]> {
  const raw = await getStringSetting(EXTRA_READERS_KEY, "").catch(() => "");
  return raw.split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * Bepaalt wie een goedgekeurd rapport moet doornemen: de projectmanager
 * (coördinator) van de klant, de vaste videograaf en iedereen die rond deze
 * maand scripts voor de klant schreef. Alleen medewerkers met leesrecht op
 * maandrapportages. Is er niemand, dan de eigenaar.
 */
export async function readersForReport(reportId: string): Promise<Array<{ userId: string; reason: string }>> {
  const [r] = await db
    .select({ clientId: clientReports.clientId, period: clientReports.period, coordinatorId: clients.coordinatorId, videographerId: clients.videographerId })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .where(eq(clientReports.id, reportId))
    .limit(1);
  if (!r) return [];

  const team = await listReportTeam();
  const allowed = new Set(team.map((t) => t.id));
  const out = new Map<string, string>();
  const add = (id: string | null | undefined, reason: string) => {
    if (id && allowed.has(id) && !out.has(id)) out.set(id, reason);
  };
  add(r.coordinatorId, "projectmanager");
  add(r.videographerId, "videograaf");

  // Scriptschrijvers: wie vanaf de maand vóór de rapportmaand tot nu scripts
  // voor deze klant schreef of bijwerkte (ook de scripts voor de komende
  // opnames, waar de inzichten direct in terecht moeten komen).
  const from = new Date(`${shiftPeriod(r.period, -1)}-01T00:00:00Z`);
  const writers = await db
    .selectDistinct({ id: scripts.creatorId })
    .from(scripts)
    .where(and(eq(scripts.clientId, r.clientId), isNull(scripts.deletedAt), isNotNull(scripts.creatorId), gte(scripts.updatedAt, from)));
  for (const w of writers) add(w.id, "scriptschrijver");

  // Vaste lezers (bv. de videograaf): nemen elke goedgekeurde rapportage door,
  // los van welke klant. Ingesteld in app_settings "reports.extra_readers".
  for (const id of await extraReaders()) add(id, "vaste lezer");

  if (out.size === 0) {
    const owner = team.find((t) => t.role === "owner");
    add(owner?.id, "eigenaar");
  }
  return [...out.entries()].map(([userId, reason]) => ({ userId, reason }));
}

/**
 * Zet de leesopdrachten klaar voor een goedgekeurd rapport. Idempotent: wie al
 * een rij heeft, houdt die (incl. eerder doornemen). De goedkeurder heeft het
 * rapport net gecontroleerd en telt direct als doorgenomen.
 */
export async function assignReportReaders(reportId: string, approverId: string | null): Promise<number> {
  const readers = await readersForReport(reportId);
  if (readers.length === 0) return 0;
  const now = new Date();
  const inserted = await db
    .insert(monthlyReportReads)
    .values(readers.map((r) => ({ reportId, userId: r.userId, reason: r.reason, readAt: r.userId === approverId ? now : null, notifiedAt: r.userId === approverId ? now : null })))
    .onConflictDoNothing()
    .returning({ id: monthlyReportReads.id });
  return inserted.length;
}

/** Medewerker markeert een rapport als doorgenomen (ook als die niet was ingedeeld). */
export async function markRead(reportId: string, userId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(monthlyReportReads)
    .values({ reportId, userId, reason: "zelf", readAt: now, notifiedAt: now })
    .onConflictDoUpdate({ target: [monthlyReportReads.reportId, monthlyReportReads.userId], set: { readAt: now } });
}

export async function markUnread(reportId: string, userId: string): Promise<void> {
  await db.update(monthlyReportReads).set({ readAt: null }).where(and(eq(monthlyReportReads.reportId, reportId), eq(monthlyReportReads.userId, userId)));
}

function amsterdamStamp(d = new Date()): string {
  return d.toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).slice(0, 13).replace(" ", "T");
}

/**
 * Teammeldingen voor maandrapportages:
 *  1. vangnet: goedgekeurde rapporten zonder leesopdrachten krijgen die alsnog;
 *  2. "staan klaar": één melding per medewerker per maand voor nieuw
 *     goedgekeurde rapporten (gebundeld, dus geen melding per klant);
 *  3. herinnering: wie na REMINDER_AFTER_DAYS dagen nog niet alles heeft
 *     doorgenomen, krijgt één gebundelde herinnering (en daarna elke
 *     REMINDER_AFTER_DAYS dagen opnieuw zolang het openstaat).
 */
export async function runReportTeamNotifications(now = new Date()): Promise<{ assigned: number; notified: number; reminded: number }> {
  // 1. Vangnet
  const approved = await db
    .select({ id: clientReports.id, approvedById: clientReports.approvedById })
    .from(clientReports)
    .where(and(inArray(clientReports.status, APPROVED_STATUSES), isNull(clientReports.deletedAt), sql`not exists (select 1 from monthly_report_reads r where r.report_id = client_reports.id)`))
    .limit(200);
  let assigned = 0;
  for (const r of approved) assigned += await assignReportReaders(r.id, r.approvedById);

  // Alleen opdrachten van rapporten die (nog) goedgekeurd zijn.
  const open = await db
    .select({ id: monthlyReportReads.id, userId: monthlyReportReads.userId, reportId: monthlyReportReads.reportId, notifiedAt: monthlyReportReads.notifiedAt, lastRemindedAt: monthlyReportReads.lastRemindedAt, period: clientReports.period })
    .from(monthlyReportReads)
    .innerJoin(clientReports, eq(clientReports.id, monthlyReportReads.reportId))
    .where(and(isNull(monthlyReportReads.readAt), inArray(clientReports.status, APPROVED_STATUSES), isNull(clientReports.deletedAt)));

  // 2. "Staan klaar"
  const toNotify = open.filter((o) => !o.notifiedAt);
  const byUserPeriod = new Map<string, typeof toNotify>();
  for (const o of toNotify) {
    const k = `${o.userId}|${o.period}`;
    byUserPeriod.set(k, [...(byUserPeriod.get(k) ?? []), o]);
  }
  let notified = 0;
  const stamp = amsterdamStamp(now);
  for (const [k, list] of byUserPeriod) {
    const [userId, period] = k.split("|") as [string, string];
    const maand = periodLabel(period).split(" ")[0];
    await notify({
      userIds: [userId],
      type: "report_team_ready",
      level: "info",
      title: `De maandrapportages van ${maand} staan klaar`,
      body: `Bekijk de resultaten van jouw klanten, neem de inzichten door en bepaal welke verbeteringen we komende maand gaan toepassen. (${list.length} ${list.length === 1 ? "rapportage" : "rapportages"})`,
      href: `/analytics/maandrapportages?maand=${period}&weergave=te-lezen`,
      dedupeKey: `report_team_ready:${period}:${userId}:${stamp}`,
    }).catch(() => 0);
    await db.update(monthlyReportReads).set({ notifiedAt: now }).where(inArray(monthlyReportReads.id, list.map((l) => l.id)));
    notified++;
  }

  // 3. Herinneringen (gebundeld per medewerker)
  const cutoff = new Date(now.getTime() - REMINDER_AFTER_DAYS * 86400000);
  const due = open.filter((o) => o.notifiedAt && o.notifiedAt <= cutoff && (!o.lastRemindedAt || o.lastRemindedAt <= cutoff));
  const byUser = new Map<string, typeof due>();
  for (const o of due) byUser.set(o.userId, [...(byUser.get(o.userId) ?? []), o]);
  let reminded = 0;
  for (const [userId, list] of byUser) {
    const periods = [...new Set(list.map((l) => l.period))].sort();
    const latest = periods[periods.length - 1]!;
    await notify({
      userIds: [userId],
      type: "report_team_reminder",
      level: "warning",
      title: `Nog ${list.length} ${list.length === 1 ? "maandrapportage" : "maandrapportages"} door te nemen`,
      body: `Je hebt de inzichten van ${periods.map((p) => periodLabel(p)).join(", ")} nog niet allemaal doorgenomen. Neem ze door en markeer ze als doorgenomen.`,
      href: `/analytics/maandrapportages?maand=${latest}&weergave=te-lezen`,
      dedupeKey: `report_team_reminder:${userId}:${stamp.slice(0, 10)}`,
    }).catch(() => 0);
    await db.update(monthlyReportReads).set({ lastRemindedAt: now }).where(inArray(monthlyReportReads.id, list.map((l) => l.id)));
    reminded++;
  }

  return { assigned, notified, reminded };
}
