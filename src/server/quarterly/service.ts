import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clientQuarterSettings, clients, quarterlyImprovements, quarterlyLessons, quarterlyReportEvents, quarterlyReportVersions, quarterlyReports, users,
} from "@/db/schema";
import { assertClientAccess, ForbiddenError, isOwner, requireInternal, scopeToClients, type Viewer } from "@/server/auth/context";
import { isActiveClientStatus } from "@/lib/client-status";
import {
  APPROVED_QUARTER_STATUSES, PAKKET_LABEL, approveBlocker, isAchterstallig, nextDeadline, pakketTypeOf, quarterFromKey, quarterHealth, quarterSchedule,
  type HealthCriterium, type PakketType, type Quarter, type QuarterMode, type QuarterSchedule, type QuarterStatus,
} from "@/lib/kwartaal";
import { blockingChecks, hasKlantInhoud, normalizeIntern, normalizeKlant, quarterChecks, type QuarterCheck, type QuarterIntern, type QuarterKlant } from "@/lib/kwartaal-inhoud";
import { toKlantMetrics, type KlantRapport } from "@/lib/kwartaal-klant";
import { thumbnailsFor } from "@/server/reports/metrics";
import type { Doel, QuarterMetrics } from "./metrics";
import { amsterdamToday, holidaysAround, type VersionContent } from "./run";
import { quarterController, quarterPeople } from "./workflow";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/* ------------------------------------------------------------------ *
 * Toegang
 * ------------------------------------------------------------------ */

/** Teamleden zonder controlerecht zien alleen goedgekeurde rapportages. */
export function isQuarterTeamReader(viewer: Viewer): boolean {
  return !viewer.permissions.has("reports:read") && viewer.permissions.has("reports:team_read");
}
export function canSeeQuarterReports(viewer: Viewer): boolean {
  return !viewer.isPortalUser && (viewer.permissions.has("reports:read") || viewer.permissions.has("reports:team_read"));
}
/** Definitief goedkeuren: de eigenaar, of wie het recht `reports:approve` heeft gekregen. */
export function canApproveQuarter(viewer: Viewer): boolean {
  return !viewer.isPortalUser && (isOwner(viewer) || viewer.permissions.has("reports:approve"));
}
export async function requireQuarterAccess(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!canSeeQuarterReports(viewer)) throw new ForbiddenError("Hiervoor is leesrecht op rapportages nodig. Vraag een beheerder om toegang.");
  return viewer;
}

/* ------------------------------------------------------------------ *
 * Overzicht (interne pagina)
 * ------------------------------------------------------------------ */

export type QuarterRow = {
  id: string;
  clientId: string; clientName: string; clientSlug: string; logoUrl: string | null; color: string | null; clientActive: boolean;
  periodKey: string; periodLabel: string; periodStart: string; periodEnd: string; periodMode: QuarterMode; year: number;
  /** "Q4" of "Contractkwartaal 3". */
  kwartaalNaam: string;
  status: QuarterStatus;
  voorlopig: boolean;
  bezig: boolean;
  inWachtrij: boolean;
  hasContent: boolean;
  pakketType: PakketType; contractvorm: string;
  verantwoordelijkeId: string | null; verantwoordelijke: string | null;
  deadline: { datum: string; label: string; teLaat: boolean } | null;
  achterstallig: boolean;
  /** Het kwartaal is voorbij (historisch of in afronding). */
  afgelopen: boolean;
  ontbrekend: number;
  wachtReden: string | null;
  errorMessage: string | null;
  versie: number;
  publishedVersion: number | null;
  /** Er staat een oudere versie in het klantportaal terwijl de rapportage is heropend. */
  portaalLooptAchter: boolean;
  gecontroleerd: boolean;
  approvedByName: string | null;
  generatedAt: string | null; approvedAt: string | null; publishedAt: string | null;
  mijn: boolean;
};

export type QuarterOverview = {
  rows: QuarterRow[];
  clients: Array<{ id: string; name: string; active: boolean }>;
  medewerkers: Array<{ id: string; name: string }>;
  jaren: number[];
  kwartalen: string[];
  teamOnly: boolean;
  today: string;
};

function kwartaalNaam(q: Quarter): string {
  return q.mode === "kalender" ? `Q${q.index}` : q.index > 0 ? `Contractkwartaal ${q.index}` : "Contractkwartaal";
}

export async function listQuarterlyReports(viewer: Viewer): Promise<QuarterOverview> {
  const teamOnly = isQuarterTeamReader(viewer);
  const today = amsterdamToday();
  const holidays = holidaysAround(today);
  const scope = scopeToClients(viewer, quarterlyReports.clientId);
  const approver = db.$with("approver").as(db.select({ id: users.id, name: users.fullName }).from(users));
  const [people, rows] = await Promise.all([
    quarterPeople(),
    db.with(approver)
      .select({
        r: quarterlyReports, clientName: clients.name, clientSlug: clients.slug, logoUrl: clients.logoUrl, color: clients.color, clientStatus: clients.status,
        coordinatorId: clients.coordinatorId, startedOn: clients.startedOn, contentFocus: clients.contentFocus, approvedByName: approver.name,
      })
      .from(quarterlyReports)
      .innerJoin(clients, eq(clients.id, quarterlyReports.clientId))
      .leftJoin(approver, eq(approver.id, quarterlyReports.approvedById))
      .where(and(isNull(quarterlyReports.deletedAt), isNull(clients.deletedAt), scope ?? undefined, teamOnly ? inArray(quarterlyReports.status, APPROVED_QUARTER_STATUSES) : undefined))
      .orderBy(desc(quarterlyReports.periodEnd), asc(clients.name)),
  ]);

  const out: QuarterRow[] = [];
  for (const x of rows) {
    const r = x.r;
    const q = quarterFromKey(r.periodKey, x.startedOn ? String(x.startedOn).slice(0, 10) : null);
    if (!q) continue;
    const status = r.status as QuarterStatus;
    const controller = quarterController(x.coordinatorId, people);
    const pakket = r.pakketType !== "onbekend" ? (r.pakketType as PakketType) : pakketTypeOf(x.contentFocus);
    out.push({
      id: r.id, clientId: r.clientId, clientName: x.clientName, clientSlug: x.clientSlug, logoUrl: x.logoUrl, color: x.color,
      clientActive: isActiveClientStatus(String(x.clientStatus)),
      periodKey: r.periodKey, periodLabel: q.label, periodStart: q.from, periodEnd: q.to, periodMode: q.mode, year: q.year, kwartaalNaam: kwartaalNaam(q),
      status, voorlopig: r.voorlopig,
      bezig: Boolean(r.startedAt && Date.now() - r.startedAt.getTime() < 20 * 60000),
      inWachtrij: Boolean(r.queued),
      hasContent: hasKlantInhoud(normalizeKlant(r.klant)),
      pakketType: pakket,
      contractvorm: `${PAKKET_LABEL[pakket]} · ${q.mode === "contract" ? "contractkwartaal" : "kalenderkwartaal"}`,
      verantwoordelijkeId: controller, verantwoordelijke: controller ? people.names.get(controller) ?? null : null,
      deadline: nextDeadline({ status }, q, today, holidays),
      achterstallig: isAchterstallig({ status }, q, today, holidays),
      afgelopen: today > q.to,
      ontbrekend: Array.isArray(r.ontbrekend) ? (r.ontbrekend as unknown[]).length : 0,
      wachtReden: r.wachtReden, errorMessage: r.errorMessage,
      versie: r.versionNumber, publishedVersion: r.publishedVersion,
      portaalLooptAchter: r.publishedVersion !== null && status !== "gepubliceerd",
      gecontroleerd: Boolean(r.reviewedAt),
      approvedByName: x.approvedByName ?? null,
      generatedAt: iso(r.generatedAt), approvedAt: iso(r.approvedAt), publishedAt: iso(r.publishedAt),
      mijn: controller === viewer.id || (people.approver === viewer.id && status === "klaar_voor_controle" && Boolean(r.reviewedAt)),
    });
  }

  const clientScope = scopeToClients(viewer, clients.id);
  const clientRows = await db.select({ id: clients.id, name: clients.name, status: clients.status }).from(clients)
    .where(and(isNull(clients.deletedAt), notInArray(clients.status, ["prospect"]), clientScope ?? undefined)).orderBy(asc(clients.name));
  const mw = new Map<string, string>();
  for (const r of out) if (r.verantwoordelijkeId && r.verantwoordelijke) mw.set(r.verantwoordelijkeId, r.verantwoordelijke);

  return {
    rows: out,
    clients: clientRows.map((c) => ({ id: c.id, name: c.name, active: isActiveClientStatus(String(c.status)) })),
    medewerkers: [...mw.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "nl")),
    jaren: [...new Set(out.map((r) => r.year))].sort((a, b) => b - a),
    kwartalen: [...new Set(out.map((r) => r.kwartaalNaam))].sort(),
    teamOnly, today,
  };
}

/* ------------------------------------------------------------------ *
 * Detail (controlepagina)
 * ------------------------------------------------------------------ */

export type QuarterEvent = { id: string; type: string; fromStatus: string | null; toStatus: string | null; byName: string | null; note: string | null; createdAt: string };
export type QuarterVersionItem = { versionNumber: number; kind: string; byName: string | null; note: string | null; createdAt: string; gepubliceerd: boolean };
export type ImprovementItem = { id: string; titel: string; actie: string; verantwoordelijke: string | null; status: string; note: string | null };

export type QuarterDetail = {
  id: string; clientId: string; clientName: string; clientSlug: string; logoUrl: string | null; clientActive: boolean;
  title: string; quarter: Quarter; schedule: QuarterSchedule;
  status: QuarterStatus; voorlopig: boolean; bezig: boolean; inWachtrij: boolean;
  pakketType: PakketType;
  metrics: QuarterMetrics | null;
  klant: QuarterKlant; intern: QuarterIntern;
  ontbrekend: string[]; wachtReden: string | null; errorMessage: string | null;
  openFeedback: Array<{ id: string; body: string; byName: string | null; at: string }>;
  checks: QuarterCheck[];
  approveBlocker: string | null;
  health: HealthCriterium[];
  versie: number; publishedVersion: number | null; approvedVersion: number | null;
  portaalLooptAchter: boolean;
  dataOverride: boolean;
  verantwoordelijkeId: string | null; verantwoordelijke: string | null; approverName: string | null;
  reviewedAt: string | null; reviewedByName: string | null; approvedAt: string | null; approvedByName: string | null; publishedAt: string | null; publishedByName: string | null;
  generatedAt: string | null; lessonsSavedAt: string | null;
  deadline: { datum: string; label: string; teLaat: boolean } | null; achterstallig: boolean;
  events: QuarterEvent[]; versions: QuarterVersionItem[];
  /** Verbeterpunten van deze rapportage (aangemaakt bij goedkeuring), voor de opvolging. */
  improvements: ImprovementItem[];
  settings: { mode: QuarterMode; doelen: Doel[] };
  thumbs: Record<string, string>;
  today: string;
};

function healthOf(m: QuarterMetrics | null, ontbrekend: number): HealthCriterium[] {
  if (!m) return [];
  return quarterHealth({
    viewsPct: m.vorig?.pct?.views ?? null,
    doelen: { totaal: m.doelen.length, behaald: m.doelen.filter((d) => d.behaald).length },
    dekking: m.totaal.dagen > 0 ? m.totaal.meetdagen / m.totaal.dagen : 0,
    ontbrekend,
    afspraak: m.pakket.verwachtInKwartaal !== null ? { verwacht: m.pakket.verwachtInKwartaal, gepubliceerd: m.geleverd.gepubliceerd } : null,
    verbeteringen: m.verbetermonitor ? { totaal: m.verbetermonitor.items.length, uitgevoerd: m.verbetermonitor.items.filter((i) => i.status === "uitgevoerd").length } : null,
    feedback: m.feedback,
  });
}

const metricsOf = (v: unknown): QuarterMetrics | null => (v && typeof v === "object" && "totaal" in (v as object) ? (v as QuarterMetrics) : null);

export async function getQuarterlyReport(viewer: Viewer, id: string): Promise<QuarterDetail | null> {
  if (!canSeeQuarterReports(viewer)) throw new ForbiddenError("Je hebt geen toegang tot rapportages.");
  if (!isUuid(id)) return null;
  const [x] = await db
    .select({ r: quarterlyReports, clientName: clients.name, clientSlug: clients.slug, logoUrl: clients.logoUrl, clientStatus: clients.status, coordinatorId: clients.coordinatorId, startedOn: clients.startedOn })
    .from(quarterlyReports)
    .innerJoin(clients, eq(clients.id, quarterlyReports.clientId))
    .where(and(eq(quarterlyReports.id, id), isNull(quarterlyReports.deletedAt)))
    .limit(1);
  if (!x) return null;
  const r = x.r;
  assertClientAccess(viewer, r.clientId);
  const status = r.status as QuarterStatus;
  if (isQuarterTeamReader(viewer) && !APPROVED_QUARTER_STATUSES.includes(status)) return null;
  const startedOn = x.startedOn ? String(x.startedOn).slice(0, 10) : null;
  const q = quarterFromKey(r.periodKey, startedOn);
  if (!q) return null;
  const today = amsterdamToday();
  const holidays = holidaysAround(today);

  const metrics = metricsOf(r.metrics);
  const klant = normalizeKlant(r.klant);
  const intern = normalizeIntern(r.intern);
  const ontbrekend = Array.isArray(r.ontbrekend) ? (r.ontbrekend as string[]) : [];
  const openFeedback = (Array.isArray(r.openFeedback) ? r.openFeedback : []) as QuarterDetail["openFeedback"];
  const bezig = Boolean(r.startedAt && Date.now() - r.startedAt.getTime() < 20 * 60000);
  const hasContent = hasKlantInhoud(klant);
  const checks = hasContent && metrics
    ? quarterChecks({ klant, intern, metrics, conversiesGemeten: metrics.conversies !== null || metrics.websiteKlikken !== null, ontbrekend, dataCompleet: metrics.dataCompleet, dataOverride: Boolean(r.dataOverrideAt), openFeedback: openFeedback.length })
    : [];

  const who = db.$with("who").as(db.select({ id: users.id, name: users.fullName }).from(users));
  const [people, events, versions, improvements, settingsRow, names] = await Promise.all([
    quarterPeople(),
    db.with(who).select({ e: quarterlyReportEvents, byName: who.name }).from(quarterlyReportEvents).leftJoin(who, eq(who.id, quarterlyReportEvents.byId))
      .where(eq(quarterlyReportEvents.reportId, id)).orderBy(desc(quarterlyReportEvents.createdAt)).limit(80),
    db.with(who).select({ v: { versionNumber: quarterlyReportVersions.versionNumber, kind: quarterlyReportVersions.kind, note: quarterlyReportVersions.note, createdAt: quarterlyReportVersions.createdAt }, byName: who.name })
      .from(quarterlyReportVersions).leftJoin(who, eq(who.id, quarterlyReportVersions.byId)).where(eq(quarterlyReportVersions.reportId, id)).orderBy(desc(quarterlyReportVersions.versionNumber)),
    db.select().from(quarterlyImprovements).where(eq(quarterlyImprovements.reportId, id)).orderBy(asc(quarterlyImprovements.position)),
    db.select().from(clientQuarterSettings).where(eq(clientQuarterSettings.clientId, r.clientId)).limit(1),
    db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, [r.reviewedById, r.approvedById, r.publishedById].filter((v): v is string => Boolean(v)).concat(["00000000-0000-0000-0000-000000000000"]))),
  ]);
  const nameOf = (uid: string | null) => (uid ? names.find((n) => n.id === uid)?.name ?? null : null);
  const controller = quarterController(x.coordinatorId, people);
  const topIds = metrics ? klant.topVideos.map((t) => metrics.videos.find((v) => v.key === t.key)?.id).filter((v): v is string => Boolean(v)) : [];
  const thumbs = await thumbnailsFor(topIds).catch(() => new Map<string, string>());

  const blocker = approveBlocker({ status, voorlopig: r.voorlopig, hasAnalysis: hasContent, bezig })
    ?? (blockingChecks(checks).length ? "Nog niet alle verplichte controlepunten zijn afgerond." : null);

  return {
    id: r.id, clientId: r.clientId, clientName: x.clientName, clientSlug: x.clientSlug, logoUrl: x.logoUrl, clientActive: isActiveClientStatus(String(x.clientStatus)),
    title: r.title, quarter: q, schedule: quarterSchedule(q, holidays),
    status, voorlopig: r.voorlopig, bezig, inWachtrij: Boolean(r.queued),
    pakketType: (r.pakketType as PakketType) ?? "onbekend",
    metrics, klant, intern, ontbrekend, wachtReden: r.wachtReden, errorMessage: r.errorMessage, openFeedback, checks,
    approveBlocker: blocker,
    health: healthOf(metrics, ontbrekend.length),
    versie: r.versionNumber, publishedVersion: r.publishedVersion, approvedVersion: r.approvedVersion,
    portaalLooptAchter: r.publishedVersion !== null && status !== "gepubliceerd",
    dataOverride: Boolean(r.dataOverrideAt),
    verantwoordelijkeId: controller, verantwoordelijke: controller ? people.names.get(controller) ?? null : null,
    approverName: people.approver ? people.names.get(people.approver) ?? null : null,
    reviewedAt: iso(r.reviewedAt), reviewedByName: nameOf(r.reviewedById), approvedAt: iso(r.approvedAt), approvedByName: nameOf(r.approvedById),
    publishedAt: iso(r.publishedAt), publishedByName: nameOf(r.publishedById),
    generatedAt: iso(r.generatedAt), lessonsSavedAt: iso(r.lessonsSavedAt),
    deadline: nextDeadline({ status }, q, today, holidays), achterstallig: isAchterstallig({ status }, q, today, holidays),
    events: events.map(({ e, byName }) => ({ id: e.id, type: e.type, fromStatus: e.fromStatus, toStatus: e.toStatus, byName: byName ?? null, note: e.note, createdAt: e.createdAt.toISOString() })),
    versions: versions.map(({ v, byName }) => ({ versionNumber: v.versionNumber, kind: v.kind, note: v.note, byName: byName ?? null, createdAt: v.createdAt.toISOString(), gepubliceerd: v.versionNumber === r.publishedVersion })),
    improvements: improvements.map((i) => ({ id: i.id, titel: i.titel, actie: i.actie, verantwoordelijke: i.verantwoordelijke, status: i.status, note: i.note })),
    settings: { mode: settingsRow[0]?.mode === "contract" ? "contract" : "kalender", doelen: ((settingsRow[0]?.doelen ?? {}) as Record<string, Doel[]>)[r.periodKey] ?? [] },
    thumbs: Object.fromEntries(thumbs),
    today,
  };
}

/* ------------------------------------------------------------------ *
 * PDF-gegevens (intern: werkversie; klant: bevroren gepubliceerde versie)
 * ------------------------------------------------------------------ */

export type QuarterPdfData = {
  clientId: string; clientName: string; logoUrl: string | null; pmName: string | null;
  status: QuarterStatus; title: string; quarter: Quarter; voorlopig: boolean; versie: number;
  metrics: QuarterMetrics; klant: QuarterKlant; intern: QuarterIntern; ontbrekend: string[];
  health: HealthCriterium[]; approvedAt: string | null; publishedVersion: number | null;
  thumbs: Record<string, string>;
};

/** Werkversie voor de interne PDF's (zonder viewer-scoping: de route scoopt). */
export async function loadQuarterPdfData(reportId: string): Promise<QuarterPdfData | null> {
  if (!isUuid(reportId)) return null;
  const [x] = await db
    .select({ r: quarterlyReports, clientName: clients.name, logoUrl: clients.logoUrl, startedOn: clients.startedOn, pmName: users.fullName })
    .from(quarterlyReports).innerJoin(clients, eq(clients.id, quarterlyReports.clientId)).leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(eq(quarterlyReports.id, reportId), isNull(quarterlyReports.deletedAt))).limit(1);
  if (!x) return null;
  const metrics = metricsOf(x.r.metrics);
  const q = quarterFromKey(x.r.periodKey, x.startedOn ? String(x.startedOn).slice(0, 10) : null);
  if (!metrics || !q) return null;
  const klant = normalizeKlant(x.r.klant);
  const ontbrekend = Array.isArray(x.r.ontbrekend) ? (x.r.ontbrekend as string[]) : [];
  const ids = klant.topVideos.map((t) => metrics.videos.find((v) => v.key === t.key)?.id).filter((v): v is string => Boolean(v));
  const thumbs = await thumbnailsFor(ids).catch(() => new Map<string, string>());
  return {
    clientId: x.r.clientId, clientName: x.clientName, logoUrl: x.logoUrl, pmName: x.pmName ?? null, status: x.r.status as QuarterStatus, title: x.r.title, quarter: q,
    voorlopig: x.r.voorlopig, versie: x.r.versionNumber, metrics, klant, intern: normalizeIntern(x.r.intern), ontbrekend,
    health: healthOf(metrics, ontbrekend.length), approvedAt: iso(x.r.approvedAt), publishedVersion: x.r.publishedVersion,
    thumbs: Object.fromEntries(thumbs),
  };
}

/**
 * De klantweergave van één vastgelegde versie. Bevat per constructie geen
 * interne informatie (zie toKlantMetrics): de interne verdieping wordt niet
 * eens uit de versie gelezen.
 */
async function klantRapportVanVersie(reportId: string, versionNumber: number): Promise<KlantRapport | null> {
  const [x] = await db
    .select({ content: quarterlyReportVersions.content, clientName: clients.name, logoUrl: clients.logoUrl, startedOn: clients.startedOn, publishedAt: quarterlyReports.publishedAt, periodKey: quarterlyReports.periodKey })
    .from(quarterlyReportVersions)
    .innerJoin(quarterlyReports, eq(quarterlyReports.id, quarterlyReportVersions.reportId))
    .innerJoin(clients, eq(clients.id, quarterlyReports.clientId))
    .where(and(eq(quarterlyReportVersions.reportId, reportId), eq(quarterlyReportVersions.versionNumber, versionNumber)))
    .limit(1);
  if (!x) return null;
  const c = x.content as unknown as VersionContent;
  const metrics = metricsOf(c.metrics);
  const q = quarterFromKey(x.periodKey, x.startedOn ? String(x.startedOn).slice(0, 10) : null);
  if (!metrics || !q) return null;
  const klant = normalizeKlant(c.klant);
  const km = toKlantMetrics(metrics, klant);
  const thumbs = await thumbnailsFor(km.topVideos.map((v) => v.id)).catch(() => new Map<string, string>());
  return {
    id: reportId, title: c.title, periodKey: c.periodKey, periodLabel: q.label, periodStart: q.from, periodEnd: q.to,
    clientName: x.clientName, logoUrl: x.logoUrl, versie: versionNumber, publishedAt: iso(x.publishedAt), klant, metrics: km,
    thumbs: Object.fromEntries(thumbs),
  };
}

/** Klantversie van de werkversie (voor de interne controle en de concept-PDF). */
export async function klantRapportVanWerkversie(reportId: string): Promise<KlantRapport | null> {
  const d = await loadQuarterPdfData(reportId);
  if (!d) return null;
  return {
    id: reportId, title: d.title, periodKey: d.quarter.key, periodLabel: d.quarter.label, periodStart: d.quarter.from, periodEnd: d.quarter.to,
    clientName: d.clientName, logoUrl: d.logoUrl, versie: d.versie, publishedAt: null, klant: d.klant, metrics: toKlantMetrics(d.metrics, d.klant), thumbs: d.thumbs,
  };
}

/* ------------------------------------------------------------------ *
 * Klantportaal: uitsluitend de gepubliceerde, bevroren versie
 * ------------------------------------------------------------------ */

export type PortalQuarterItem = {
  id: string; periodKey: string; periodLabel: string; title: string; publishedAt: string | null; nieuw: boolean; samenvatting: string;
  /** Kerncijfers van de gepubliceerde versie, voor de vergelijking tussen kwartalen. */
  totaal: { views: number; reach: number; engagements: number; videos: number; followerGrowth: number; gemViewsPerVideo: number | null; meetdagen: number; dagen: number } | null;
};

function portalClientId(viewer: Viewer): string | null {
  if (!viewer.isPortalUser || !viewer.clientScope || viewer.clientScope.length === 0) return null;
  return viewer.clientScope[0]!;
}

export async function getPortalQuarterlyReports(viewer: Viewer): Promise<PortalQuarterItem[]> {
  const clientId = portalClientId(viewer);
  if (!clientId) return [];
  const rows = await db
    .select({ id: quarterlyReports.id, periodKey: quarterlyReports.periodKey, publishedAt: quarterlyReports.publishedAt, publishedVersion: quarterlyReports.publishedVersion, startedOn: clients.startedOn, content: quarterlyReportVersions.content })
    .from(quarterlyReports)
    .innerJoin(clients, eq(clients.id, quarterlyReports.clientId))
    .innerJoin(quarterlyReportVersions, and(eq(quarterlyReportVersions.reportId, quarterlyReports.id), eq(quarterlyReportVersions.versionNumber, quarterlyReports.publishedVersion)))
    .where(and(eq(quarterlyReports.clientId, clientId), isNotNull(quarterlyReports.publishedVersion), isNull(quarterlyReports.deletedAt)))
    .orderBy(desc(quarterlyReports.periodEnd))
    .limit(24);
  return rows.flatMap((r) => {
    const q = quarterFromKey(r.periodKey, r.startedOn ? String(r.startedOn).slice(0, 10) : null);
    if (!q) return [];
    const c = r.content as unknown as VersionContent;
    return [{
      id: r.id, periodKey: r.periodKey, periodLabel: q.label, title: c.title, publishedAt: iso(r.publishedAt),
      nieuw: Boolean(r.publishedAt && Date.now() - r.publishedAt.getTime() < 14 * 86_400_000),
      samenvatting: normalizeKlant(c.klant).samenvatting.kern.slice(0, 320),
      totaal: (() => {
        const t = metricsOf(c.metrics)?.totaal;
        return t ? { views: t.views, reach: t.reach, engagements: t.engagements, videos: t.videos, followerGrowth: t.followerGrowth, gemViewsPerVideo: t.gemViewsPerVideo, meetdagen: t.meetdagen, dagen: t.dagen } : null;
      })(),
    }];
  });
}

/** Eén gepubliceerde kwartaalrapportage van de eigen klant. Hard gescoopt. */
export async function getPortalQuarterDetail(viewer: Viewer, reportId: string): Promise<KlantRapport | null> {
  const clientId = portalClientId(viewer);
  if (!clientId || !isUuid(reportId)) return null;
  const [r] = await db.select({ clientId: quarterlyReports.clientId, publishedVersion: quarterlyReports.publishedVersion })
    .from(quarterlyReports).where(and(eq(quarterlyReports.id, reportId), isNull(quarterlyReports.deletedAt))).limit(1);
  if (!r || r.clientId !== clientId || r.publishedVersion === null) return null;
  return klantRapportVanVersie(reportId, r.publishedVersion);
}

/** Gepubliceerde versie voor de interne kant (controle van wat de klant ziet). */
export async function getPublishedKlantRapport(reportId: string): Promise<KlantRapport | null> {
  const [r] = await db.select({ publishedVersion: quarterlyReports.publishedVersion }).from(quarterlyReports).where(eq(quarterlyReports.id, reportId)).limit(1);
  if (!r || r.publishedVersion === null) return null;
  return klantRapportVanVersie(reportId, r.publishedVersion);
}

/* ------------------------------------------------------------------ *
 * Klantpagina: meest recente kwartaal, status en eerstvolgende deadline
 * ------------------------------------------------------------------ */

export type ClientQuarterSummary = {
  id: string; periodLabel: string; status: QuarterStatus; voorlopig: boolean;
  deadline: { datum: string; label: string; teLaat: boolean } | null; achterstallig: boolean;
  laatstGepubliceerd: { id: string; periodLabel: string; publishedAt: string | null } | null;
  mode: QuarterMode;
};

export async function clientQuarterSummary(clientId: string): Promise<ClientQuarterSummary | null> {
  const [c] = await db.select({ startedOn: clients.startedOn }).from(clients).where(eq(clients.id, clientId)).limit(1);
  const startedOn = c?.startedOn ? String(c.startedOn).slice(0, 10) : null;
  const rows = await db.select({ id: quarterlyReports.id, periodKey: quarterlyReports.periodKey, status: quarterlyReports.status, voorlopig: quarterlyReports.voorlopig, publishedVersion: quarterlyReports.publishedVersion, publishedAt: quarterlyReports.publishedAt, periodMode: quarterlyReports.periodMode })
    .from(quarterlyReports).where(and(eq(quarterlyReports.clientId, clientId), isNull(quarterlyReports.deletedAt))).orderBy(desc(quarterlyReports.periodEnd)).limit(8);
  if (rows.length === 0) return null;
  const today = amsterdamToday();
  const holidays = holidaysAround(today);
  // Het rapport waar nu werk in zit: het meest recente dat nog niet gepubliceerd is, anders het nieuwste.
  const actueel = rows.find((r) => r.status !== "gepubliceerd" && r.status !== "gepland") ?? rows[0]!;
  const q = quarterFromKey(actueel.periodKey, startedOn);
  if (!q) return null;
  const pub = rows.find((r) => r.publishedVersion !== null);
  const pubQ = pub ? quarterFromKey(pub.periodKey, startedOn) : null;
  const status = actueel.status as QuarterStatus;
  return {
    id: actueel.id, periodLabel: q.label, status, voorlopig: actueel.voorlopig,
    deadline: nextDeadline({ status }, q, today, holidays), achterstallig: isAchterstallig({ status }, q, today, holidays),
    laatstGepubliceerd: pub && pubQ ? { id: pub.id, periodLabel: pubQ.label, publishedAt: iso(pub.publishedAt) } : null,
    mode: actueel.periodMode === "contract" ? "contract" : "kalender",
  };
}

/* ------------------------------------------------------------------ *
 * Lessen voor Contentgeheugen en Scripting (alleen na goedkeuring)
 * ------------------------------------------------------------------ */

export type QuarterLesson = { id: string; periodLabel: string; kind: string; text: string; zekerheid: string; createdAt: string };

export async function quarterLessonsForClient(clientId: string, limit = 24): Promise<QuarterLesson[]> {
  const rows = await db.select().from(quarterlyLessons).where(eq(quarterlyLessons.clientId, clientId)).orderBy(desc(quarterlyLessons.createdAt)).limit(limit);
  return rows.map((l) => ({ id: l.id, periodLabel: l.periodLabel, kind: l.kind, text: l.text, zekerheid: l.zekerheid, createdAt: l.createdAt.toISOString() }));
}

const KIND_LABEL: Record<string, string> = { vaker: "Vaker maken", minder: "Minder vaak maken", onderwerp: "Onderwerp", hook: "Hook", format: "Format", lengte: "Videolengte", presentator: "Presentator", doelgroep: "Doelgroep" };
export const lessonKindLabel = (k: string) => KIND_LABEL[k] ?? "Les";

/** Als tekst voor de Script Engine: de goedgekeurde inzichten van de laatste twee kwartalen. */
export async function quarterLessonsPromptText(clientId: string): Promise<string> {
  const ls = await quarterLessonsForClient(clientId, 40).catch(() => []);
  if (!ls.length) return "";
  const perioden = [...new Set(ls.map((l) => l.periodLabel))].slice(0, 2);
  const lines = ls.filter((l) => perioden.includes(l.periodLabel)).slice(0, 16)
    .map((l) => `- ${lessonKindLabel(l.kind)}: ${l.text}${l.zekerheid === "bewezen" ? "" : ` (${l.zekerheid})`}`);
  return `INZICHTEN UIT DE GOEDGEKEURDE KWARTAALRAPPORTAGE (${perioden.join(" en ")}; door het team gecontroleerd):\n${lines.join("\n")}`;
}
