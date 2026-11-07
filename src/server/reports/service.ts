import "server-only";
import { and, asc, desc, eq, inArray, isNull, like, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, monthlyReportFeedback, monthlyReportReads, monthlyReportVersions, tasks, users } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requireInternal, scopeToClients, type Viewer } from "@/server/auth/context";
import { periodLabel } from "./analysis";
import { checkReportQuality, type Beoordeling, type QualityIssue } from "./quality";
import { duplicateIssue, findDuplicateMetricClients, monthVideos, platformSplit, thumbnailsFor, type MaandCijfers, type MonthVideo, type Vergelijking } from "./metrics";
import type { MonthlyAnalysis } from "./analysis";

export type ReportStatus =
  | "gegevens_verzamelen" | "analyse_bezig" | "klaar_voor_controle" | "aanpassing_nodig" | "goedgekeurd" | "gepubliceerd" | "mislukt";

/** Klantstatussen die als "actief" tellen; de rest (paused, churned, prospect) is inactief. */
export const ACTIVE_CLIENT_STATUSES = ["active", "onboarding"] as const;
export const isActiveClientStatus = (s: string) => (ACTIVE_CLIENT_STATUSES as readonly string[]).includes(s);

/** Statussen waarin een rapport intern is goedgekeurd (en dus door het team gelezen mag worden). */
export const APPROVED_STATUSES: ReportStatus[] = ["goedgekeurd", "gepubliceerd"];

/** Of de viewer alleen goedgekeurde rapporten mag zien (teamleden zonder reports:read). */
export function isTeamReader(viewer: Viewer): boolean {
  return !viewer.permissions.has("reports:read") && viewer.permissions.has("reports:team_read");
}
export function canSeeReports(viewer: Viewer): boolean {
  return !viewer.isPortalUser && (viewer.permissions.has("reports:read") || viewer.permissions.has("reports:team_read"));
}

/** Toegang tot de maandrapportagepagina's: controlerecht óf teamleesrecht. */
export async function requireReportsAccess(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!canSeeReports(viewer)) throw new ForbiddenError("Hiervoor is leesrecht op maandrapportages nodig. Vraag een beheerder om toegang.");
  return viewer;
}

export type ReportRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientStatus: string;
  clientActive: boolean;
  logoUrl: string | null;
  color: string | null;
  slug: string;
  period: string;
  periodLabel: string;
  pmId: string | null;
  pmName: string | null;
  status: ReportStatus;
  aantalVideos: number;
  views: number;
  ontbrekend: number;
  generatedAt: string | null;
  updatedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  /** De persoonlijke beoordeling is ingevuld (controle gedaan). */
  beoordeeld: boolean;
  feedbackOpen: number;
  verbeterpunten: number;
  readsTotal: number;
  readsDone: number;
  assignedToMe: boolean;
  readByMe: boolean;
  openActies: number;
  actiesTotaal: number;
};

export type TeamReadStat = { userId: string; name: string; assigned: number; read: number; openReportIds: string[] };

export type ReportOverview = {
  reports: ReportRow[];
  /** Alle klanten (voor filters en "ontbreekt"). */
  clients: Array<{ id: string; name: string; status: string; active: boolean; pmId: string | null; pmName: string | null }>;
  periods: string[];
  team: Record<string, TeamReadStat[]>;
  teamOnly: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

/** Hoofdscherm: alle maandrapporten (gescoopt), klanten, teamvoortgang. */
export async function listMonthlyReports(viewer: Viewer): Promise<ReportOverview> {
  const teamOnly = isTeamReader(viewer);
  const scope = scopeToClients(viewer, clientReports.clientId);
  const rows = await db
    .select({
      id: clientReports.id,
      clientId: clientReports.clientId,
      clientName: clients.name,
      clientStatus: clients.status,
      logoUrl: clients.logoUrl,
      color: clients.color,
      slug: clients.slug,
      period: clientReports.period,
      status: clientReports.status,
      metrics: clientReports.metrics,
      analysis: clientReports.analysis,
      beoordeling: clientReports.beoordeling,
      ontbrekendeGegevens: clientReports.ontbrekendeGegevens,
      generatedAt: clientReports.generatedAt,
      updatedAt: clientReports.updatedAt,
      approvedAt: clientReports.approvedAt,
      publishedAt: clientReports.publishedAt,
      pmId: clients.coordinatorId,
      pmName: users.fullName,
    })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(
      eq(clientReports.periodType, "month"),
      isNull(clientReports.deletedAt),
      scope ?? undefined,
      teamOnly ? inArray(clientReports.status, APPROVED_STATUSES) : undefined,
    ))
    .orderBy(desc(clientReports.period), asc(clients.name));

  const ids = rows.map((r) => r.id);
  const [reads, feedback, actionTasks] = ids.length
    ? await Promise.all([
        db.select({ reportId: monthlyReportReads.reportId, userId: monthlyReportReads.userId, readAt: monthlyReportReads.readAt, name: users.fullName })
          .from(monthlyReportReads)
          .innerJoin(users, eq(users.id, monthlyReportReads.userId))
          .where(and(inArray(monthlyReportReads.reportId, ids), eq(users.status, "active"))),
        db.select({ reportId: monthlyReportFeedback.reportId, resolved: monthlyReportFeedback.resolvedInVersion })
          .from(monthlyReportFeedback)
          .where(inArray(monthlyReportFeedback.reportId, ids)),
        db.select({ entityId: tasks.entityId, status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.entityType, "client_report"), like(tasks.dedupeKey, "report_action:%"), isNull(tasks.deletedAt), inArray(tasks.entityId, ids))),
      ])
    : [[], [], []];

  const readsBy = new Map<string, typeof reads>();
  for (const r of reads) readsBy.set(r.reportId, [...(readsBy.get(r.reportId) ?? []), r]);
  const fbOpen = new Map<string, number>();
  for (const f of feedback) if (f.resolved == null) fbOpen.set(f.reportId, (fbOpen.get(f.reportId) ?? 0) + 1);
  const acts = new Map<string, { open: number; total: number }>();
  for (const t of actionTasks) {
    if (!t.entityId) continue;
    const cur = acts.get(t.entityId) ?? { open: 0, total: 0 };
    cur.total++;
    if (t.status !== "done" && t.status !== "cancelled") cur.open++;
    acts.set(t.entityId, cur);
  }

  const reports: ReportRow[] = rows.map((r) => {
    const m = (r.metrics ?? {}) as { posts?: number; views?: number };
    const a = (r.analysis ?? {}) as Partial<MonthlyAnalysis>;
    const b = (r.beoordeling ?? {}) as Beoordeling;
    const rr = readsBy.get(r.id) ?? [];
    const mine = rr.find((x) => x.userId === viewer.id);
    return {
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName,
      clientStatus: String(r.clientStatus),
      clientActive: isActiveClientStatus(String(r.clientStatus)),
      logoUrl: r.logoUrl,
      color: r.color,
      slug: r.slug,
      period: r.period,
      periodLabel: periodLabel(r.period),
      pmId: r.pmId,
      pmName: r.pmName,
      status: r.status as ReportStatus,
      aantalVideos: num(m.posts),
      views: num(m.views),
      ontbrekend: Array.isArray(r.ontbrekendeGegevens) ? (r.ontbrekendeGegevens as unknown[]).length : 0,
      generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      beoordeeld: Boolean((b.positief ?? "").trim() && (b.verbeteren ?? "").trim() && (b.volgendeMaand ?? "").trim()),
      feedbackOpen: fbOpen.get(r.id) ?? 0,
      verbeterpunten: (Array.isArray(a.verbeterpunten) ? a.verbeterpunten.length : 0) + (Array.isArray(a.intern?.acties) ? a.intern!.acties.length : 0),
      readsTotal: rr.length,
      readsDone: rr.filter((x) => x.readAt).length,
      assignedToMe: Boolean(mine),
      readByMe: Boolean(mine?.readAt),
      openActies: acts.get(r.id)?.open ?? 0,
      actiesTotaal: acts.get(r.id)?.total ?? 0,
    };
  });

  // Teamvoortgang per maand: wie heeft wat (nog niet) doorgenomen.
  const team: Record<string, TeamReadStat[]> = {};
  const periodOf = new Map(reports.map((r) => [r.id, r.period]));
  const perPeriod = new Map<string, Map<string, TeamReadStat>>();
  for (const r of reads) {
    const p = periodOf.get(r.reportId);
    if (!p) continue;
    const m = perPeriod.get(p) ?? new Map<string, TeamReadStat>();
    const s = m.get(r.userId) ?? { userId: r.userId, name: r.name ?? "Onbekend", assigned: 0, read: 0, openReportIds: [] };
    s.assigned++;
    if (r.readAt) s.read++;
    else s.openReportIds.push(r.reportId);
    m.set(r.userId, s);
    perPeriod.set(p, m);
  }
  for (const [p, m] of perPeriod) team[p] = [...m.values()].sort((a, b) => a.name.localeCompare(b.name));

  const clientScope = scopeToClients(viewer, clients.id);
  const clientRows = await db
    .select({ id: clients.id, name: clients.name, status: clients.status, pmId: clients.coordinatorId, pmName: users.fullName })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(isNull(clients.deletedAt), notInArray(clients.status, ["prospect"]), clientScope ?? undefined))
    .orderBy(asc(clients.name));

  const periods = [...new Set(reports.map((r) => r.period))].sort().reverse();

  return {
    reports,
    clients: clientRows.map((c) => ({ id: c.id, name: c.name, status: String(c.status), active: isActiveClientStatus(String(c.status)), pmId: c.pmId, pmName: c.pmName })),
    periods,
    team,
    teamOnly,
  };
}

export type FeedbackItem = { id: string; body: string; authorName: string | null; createdAt: string; versionNumber: number | null; resolvedInVersion: number | null };
export type VersionItem = { versionNumber: number; kind: string; createdAt: string; byName: string | null };
export type ReadItem = { userId: string; name: string; reason: string; readAt: string | null };
export type ActionTask = { id: string; title: string; status: string; assigneeName: string | null; dueOn: string | null; dedupeKey: string };
export type HistoryItem = { id: string | null; period: string; periodLabel: string; status: ReportStatus | null; cijfers: MaandCijfers };

export type ReportDetail = {
  id: string;
  clientId: string;
  clientName: string;
  clientStatus: string;
  clientActive: boolean;
  logoUrl: string | null;
  slug: string;
  period: string;
  periodLabel: string;
  title: string;
  status: ReportStatus;
  analysis: MonthlyAnalysis | null;
  beoordeling: Beoordeling;
  manualNote: string;
  metrics: Record<string, unknown>;
  vergelijking: Vergelijking | null;
  ontbrekend: string[];
  quality: QualityIssue[];
  pmId: string | null;
  pmName: string | null;
  generatedAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  /** Analyse staat langer dan 20 minuten op 'bezig' (vastgelopen). */
  stale: boolean;
  feedback: FeedbackItem[];
  versions: VersionItem[];
  reads: ReadItem[];
  actionTasks: ActionTask[];
  history: HistoryItem[];
};

/** Controlepagina: volledig rapport + kwaliteitscontrole. Hard gescoopt. */
export async function getMonthlyReport(viewer: Viewer, id: string): Promise<ReportDetail | null> {
  if (!canSeeReports(viewer)) throw new ForbiddenError("Je hebt geen toegang tot maandrapportages.");
  if (!isUuid(id)) return null;
  const approver = db.$with("approver").as(db.select({ id: users.id, name: users.fullName }).from(users));
  const [r] = await db
    .with(approver)
    .select({
      id: clientReports.id,
      clientId: clientReports.clientId,
      clientName: clients.name,
      clientStatus: clients.status,
      logoUrl: clients.logoUrl,
      slug: clients.slug,
      period: clientReports.period,
      title: clientReports.title,
      status: clientReports.status,
      analysis: clientReports.analysis,
      beoordeling: clientReports.beoordeling,
      manualNote: clientReports.manualNote,
      metrics: clientReports.metrics,
      ontbrekendeGegevens: clientReports.ontbrekendeGegevens,
      generatedAt: clientReports.generatedAt,
      approvedAt: clientReports.approvedAt,
      approvedByName: approver.name,
      publishedAt: clientReports.publishedAt,
      errorMessage: clientReports.errorMessage,
      startedAt: clientReports.startedAt,
      pmId: clients.coordinatorId,
      pmName: users.fullName,
    })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .leftJoin(approver, eq(approver.id, clientReports.approvedById))
    .where(and(eq(clientReports.id, id), isNull(clientReports.deletedAt)))
    .limit(1);
  if (!r) return null;
  assertClientAccess(viewer, r.clientId);
  // Teamleden zonder controlerecht zien alleen intern goedgekeurde rapporten.
  if (isTeamReader(viewer) && !APPROVED_STATUSES.includes(r.status as ReportStatus)) return null;

  const analysis = (r.analysis && Object.keys(r.analysis).length ? (r.analysis as unknown as MonthlyAnalysis) : null);
  const beoordeling = (r.beoordeling ?? {}) as Beoordeling;
  const metrics = (r.metrics ?? {}) as Record<string, unknown>;
  const ontbrekend = Array.isArray(r.ontbrekendeGegevens) ? (r.ontbrekendeGegevens as string[]) : [];
  const dubbel = duplicateIssue(await findDuplicateMetricClients(r.clientId, r.period));
  const quality = checkReportQuality({
    clientName: r.clientName,
    analysis,
    beoordeling,
    metrics: metrics as { views?: number; posts?: number; viewsGrowthPct?: number | null },
    ontbrekendeGegevens: ontbrekend,
    dubbel,
  });

  const author = db.$with("author").as(db.select({ id: users.id, name: users.fullName }).from(users));
  const [feedback, versions, reads, actionTasks, otherReports] = await Promise.all([
    db.with(author)
      .select({ id: monthlyReportFeedback.id, body: monthlyReportFeedback.body, authorName: author.name, createdAt: monthlyReportFeedback.createdAt, versionNumber: monthlyReportFeedback.versionNumber, resolvedInVersion: monthlyReportFeedback.resolvedInVersion })
      .from(monthlyReportFeedback)
      .leftJoin(author, eq(author.id, monthlyReportFeedback.authorId))
      .where(eq(monthlyReportFeedback.reportId, id))
      .orderBy(desc(monthlyReportFeedback.createdAt)),
    db.select({ versionNumber: monthlyReportVersions.versionNumber, kind: monthlyReportVersions.kind, createdAt: monthlyReportVersions.createdAt, byName: users.fullName })
      .from(monthlyReportVersions)
      .leftJoin(users, eq(users.id, monthlyReportVersions.approvedById))
      .where(eq(monthlyReportVersions.reportId, id))
      .orderBy(desc(monthlyReportVersions.versionNumber)),
    db.select({ userId: monthlyReportReads.userId, name: users.fullName, reason: monthlyReportReads.reason, readAt: monthlyReportReads.readAt })
      .from(monthlyReportReads)
      .innerJoin(users, eq(users.id, monthlyReportReads.userId))
      .where(eq(monthlyReportReads.reportId, id))
      .orderBy(asc(users.fullName)),
    db.select({ id: tasks.id, title: tasks.title, status: tasks.status, assigneeName: users.fullName, dueOn: tasks.dueOn, dedupeKey: tasks.dedupeKey })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(eq(tasks.entityType, "client_report"), eq(tasks.entityId, id), like(tasks.dedupeKey, "report_action:%"), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.createdAt)),
    db.select({ id: clientReports.id, period: clientReports.period, status: clientReports.status })
      .from(clientReports)
      .where(and(eq(clientReports.clientId, r.clientId), eq(clientReports.periodType, "month"), isNull(clientReports.deletedAt))),
  ]);

  // Ontwikkeling over meerdere maanden: cijfers uit de opgeslagen historie,
  // gekoppeld aan het rapport van die maand (als dat bestaat).
  const historie = Array.isArray(metrics.historie) ? (metrics.historie as MaandCijfers[]) : [];
  const byPeriod = new Map(otherReports.map((o) => [o.period, o]));
  const teamOnly = isTeamReader(viewer);
  const history: HistoryItem[] = historie.map((c) => {
    const o = byPeriod.get(c.maand);
    const visible = o && (!teamOnly || APPROVED_STATUSES.includes(o.status as ReportStatus));
    return { id: visible ? o!.id : null, period: c.maand, periodLabel: periodLabel(c.maand), status: visible ? (o!.status as ReportStatus) : null, cijfers: c };
  });

  return {
    id: r.id,
    clientId: r.clientId,
    clientName: r.clientName,
    clientStatus: String(r.clientStatus),
    clientActive: isActiveClientStatus(String(r.clientStatus)),
    logoUrl: r.logoUrl,
    slug: r.slug,
    period: r.period,
    periodLabel: periodLabel(r.period),
    title: r.title,
    status: r.status as ReportStatus,
    analysis,
    beoordeling,
    manualNote: r.manualNote ?? "",
    metrics,
    vergelijking: (metrics.vergelijking as Vergelijking | undefined) ?? null,
    ontbrekend,
    quality,
    pmId: r.pmId,
    pmName: r.pmName,
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    approvedByName: r.approvedByName ?? null,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    stale: r.status === "analyse_bezig" && (!r.startedAt || Date.now() - r.startedAt.getTime() > 20 * 60000),
    feedback: feedback.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
    versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
    reads: reads.map((x) => ({ userId: x.userId, name: x.name ?? "Onbekend", reason: x.reason, readAt: x.readAt ? x.readAt.toISOString() : null })),
    actionTasks: actionTasks.map((t) => ({ id: t.id, title: t.title, status: String(t.status), assigneeName: t.assigneeName, dueOn: t.dueOn ? String(t.dueOn) : null, dedupeKey: t.dedupeKey ?? "" })),
    history,
  };
}

export type ReportPdfData = {
  clientId: string;
  status: ReportStatus;
  clientName: string;
  logoUrl: string | null;
  period: string;
  periodLabel: string;
  totals: Record<string, unknown>;
  analysis: MonthlyAnalysis | null;
  klanttekst: string;
  beoordeling: Beoordeling;
  pmName: string | null;
  ontbrekend: string[];
  approvedAt: string | null;
  /** Video's van de maand met miniatuur en (als beschikbaar) het AI-inzicht per video. */
  videos: Array<MonthVideo & { thumb: string | null; inzicht: string | null }>;
};

/** Ruwe gegevens voor de PDF-opbouw (zonder viewer-scoping — de route scoopt). */
export async function loadReportPdfData(reportId: string): Promise<ReportPdfData | null> {
  if (!isUuid(reportId)) return null;
  const [r] = await db
    .select({
      clientId: clientReports.clientId, status: clientReports.status, period: clientReports.period,
      metrics: clientReports.metrics, analysis: clientReports.analysis, beoordeling: clientReports.beoordeling,
      ontbrekendeGegevens: clientReports.ontbrekendeGegevens, approvedAt: clientReports.approvedAt,
      clientName: clients.name, logoUrl: clients.logoUrl, pmName: users.fullName,
    })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(eq(clientReports.id, reportId), isNull(clientReports.deletedAt)))
    .limit(1);
  if (!r) return null;
  const analysis = r.analysis && Object.keys(r.analysis).length ? (r.analysis as unknown as MonthlyAnalysis) : null;
  const b = (r.beoordeling ?? {}) as Beoordeling;
  const totals = { ...((r.metrics ?? {}) as Record<string, unknown>) };
  // Platformverdeling: opgeslagen bij de generatie, anders live (oudere rapporten).
  if (!Array.isArray(totals.platforms)) totals.platforms = await platformSplit(r.clientId, r.period);
  // Video's: opgeslagen bij de generatie, anders (oudere rapporten) live opgehaald.
  const stored = Array.isArray(totals.videos) ? (totals.videos as MonthVideo[]) : null;
  const vids = stored ?? await monthVideos(r.clientId, r.period);
  const thumbs = await thumbnailsFor(vids.map((v) => v.id));
  const inzichten = new Map((stored && analysis?.videoInzichten ? analysis.videoInzichten : []).map((x) => [x.key, x.inzicht]));
  return {
    videos: vids.map((v) => ({ ...v, thumb: thumbs.get(v.id) ?? null, inzicht: inzichten.get(v.key) ?? null })),
    clientId: r.clientId,
    status: r.status as ReportStatus,
    clientName: r.clientName,
    logoUrl: r.logoUrl,
    period: r.period,
    periodLabel: periodLabel(r.period),
    totals,
    analysis,
    klanttekst: b.klanttekst ?? "",
    beoordeling: b,
    pmName: r.pmName,
    ontbrekend: Array.isArray(r.ontbrekendeGegevens) ? (r.ontbrekendeGegevens as string[]) : [],
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
  };
}

/** Portaal: gepubliceerde maandrapporten van de eigen klant (nieuwste eerst). */
export async function getPortalMonthlyReports(viewer: Viewer): Promise<Array<{ id: string; period: string; periodLabel: string; title: string; samenvatting: string; publishedAt: string | null }>> {
  if (!viewer.clientScope || viewer.clientScope.length === 0) return [];
  const clientId = viewer.clientScope[0]!;
  const rows = await db
    .select({ id: clientReports.id, period: clientReports.period, title: clientReports.title, beoordeling: clientReports.beoordeling, publishedAt: clientReports.publishedAt })
    .from(clientReports)
    .where(and(eq(clientReports.clientId, clientId), eq(clientReports.status, "gepubliceerd"), isNull(clientReports.deletedAt)))
    .orderBy(desc(clientReports.period))
    .limit(24);
  return rows.map((r) => {
    const b = (r.beoordeling ?? {}) as Beoordeling;
    return {
      id: r.id,
      period: r.period,
      periodLabel: periodLabel(r.period),
      title: r.title,
      samenvatting: (b.klanttekst ?? "").slice(0, 400),
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    };
  });
}

/** Interne team-medewerkers die rapporten mogen lezen (voor toewijzing en taken). */
export async function listReportTeam(): Promise<Array<{ id: string; name: string; role: string }>> {
  const res = await db.execute(sql`
    select distinct u.id, u.full_name as name, u.primary_role as role
    from users u
    join user_roles ur on ur.user_id = u.id
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.id = rp.permission_id
    where u.status = 'active' and u.deleted_at is null and u.primary_role <> 'client'
      and p.key in ('reports:read', 'reports:team_read')
    order by u.full_name`);
  return rowsOf<{ id: string; name: string; role: string }>(res).map((u) => ({ id: u.id, name: u.name, role: String(u.role) }));
}
