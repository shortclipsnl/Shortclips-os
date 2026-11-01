import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, users } from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";
import { periodLabel } from "./analysis";
import { checkReportQuality, type Beoordeling, type QualityIssue } from "./quality";
import type { MonthlyAnalysis } from "./analysis";

export type ReportStatus =
  | "gegevens_verzamelen" | "analyse_bezig" | "klaar_voor_controle" | "aanpassing_nodig" | "goedgekeurd" | "gepubliceerd" | "mislukt";

export type ReportRow = {
  id: string;
  clientId: string;
  clientName: string;
  logoUrl: string | null;
  color: string | null;
  slug: string;
  period: string;
  periodLabel: string;
  pmId: string | null;
  pmName: string | null;
  status: ReportStatus;
  aantalVideos: number;
  ontbrekend: number;
  generatedAt: string | null;
  updatedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
};

export type ReportOverview = {
  reports: ReportRow[];
  stats: { dezeMaand: number; teControleren: number; goedgekeurd: number; gepubliceerd: number; ontbrekendeGegevens: number };
  pms: Array<{ id: string; name: string }>;
};

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

/** Hoofdscherm: alle maandrapporten (gescoopt) + telblokken. */
export async function listMonthlyReports(viewer: Viewer): Promise<ReportOverview> {
  const scope = scopeToClients(viewer, clientReports.clientId);
  const rows = await db
    .select({
      id: clientReports.id,
      clientId: clientReports.clientId,
      clientName: clients.name,
      logoUrl: clients.logoUrl,
      color: clients.color,
      slug: clients.slug,
      period: clientReports.period,
      status: clientReports.status,
      metrics: clientReports.metrics,
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
    .where(and(eq(clientReports.periodType, "month"), isNull(clientReports.deletedAt), scope ?? undefined))
    .orderBy(desc(clientReports.period), desc(clientReports.updatedAt));

  const reports: ReportRow[] = rows.map((r) => {
    const m = (r.metrics ?? {}) as { posts?: number };
    const ontbrekend = Array.isArray(r.ontbrekendeGegevens) ? (r.ontbrekendeGegevens as unknown[]).length : 0;
    return {
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName,
      logoUrl: r.logoUrl,
      color: r.color,
      slug: r.slug,
      period: r.period,
      periodLabel: periodLabel(r.period),
      pmId: r.pmId,
      pmName: r.pmName,
      status: r.status as ReportStatus,
      aantalVideos: num(m.posts),
      ontbrekend,
      generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    };
  });

  const thisMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
  const stats = {
    dezeMaand: reports.filter((r) => r.period === thisMonth).length,
    teControleren: reports.filter((r) => r.status === "klaar_voor_controle" || r.status === "aanpassing_nodig").length,
    goedgekeurd: reports.filter((r) => r.status === "goedgekeurd").length,
    gepubliceerd: reports.filter((r) => r.status === "gepubliceerd").length,
    ontbrekendeGegevens: reports.filter((r) => r.ontbrekend > 0).length,
  };
  const pmMap = new Map<string, string>();
  for (const r of reports) if (r.pmId && r.pmName) pmMap.set(r.pmId, r.pmName);
  const pms = [...pmMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  return { reports, stats, pms };
}

export type ReportDetail = {
  id: string;
  clientId: string;
  clientName: string;
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
  ontbrekend: string[];
  quality: QualityIssue[];
  pmName: string | null;
  generatedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
};

/** Controlepagina: volledig rapport + kwaliteitscontrole. Hard gescoopt. */
export async function getMonthlyReport(viewer: Viewer, id: string): Promise<ReportDetail | null> {
  const [r] = await db
    .select({
      id: clientReports.id,
      clientId: clientReports.clientId,
      clientName: clients.name,
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
      publishedAt: clientReports.publishedAt,
      errorMessage: clientReports.errorMessage,
      pmName: users.fullName,
    })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(eq(clientReports.id, id), isNull(clientReports.deletedAt)))
    .limit(1);
  if (!r) return null;
  assertClientAccess(viewer, r.clientId);

  const analysis = (r.analysis && Object.keys(r.analysis).length ? (r.analysis as unknown as MonthlyAnalysis) : null);
  const beoordeling = (r.beoordeling ?? {}) as Beoordeling;
  const metrics = (r.metrics ?? {}) as Record<string, unknown>;
  const ontbrekend = Array.isArray(r.ontbrekendeGegevens) ? (r.ontbrekendeGegevens as string[]) : [];
  const quality = checkReportQuality({
    clientName: r.clientName,
    analysis,
    beoordeling,
    metrics: metrics as { views?: number; posts?: number; viewsGrowthPct?: number | null },
    ontbrekendeGegevens: ontbrekend,
  });

  return {
    id: r.id,
    clientId: r.clientId,
    clientName: r.clientName,
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
    ontbrekend,
    quality,
    pmName: r.pmName,
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    errorMessage: r.errorMessage,
  };
}

/** Ruwe gegevens voor de PDF-opbouw (zonder viewer-scoping — de route scoopt). */
export async function loadReportPdfData(reportId: string): Promise<
  | { clientId: string; status: ReportStatus; clientName: string; logoUrl: string | null; period: string; periodLabel: string; totals: Record<string, unknown>; analysis: MonthlyAnalysis | null; klanttekst: string }
  | null
> {
  const [r] = await db
    .select({
      clientId: clientReports.clientId, status: clientReports.status, period: clientReports.period,
      metrics: clientReports.metrics, analysis: clientReports.analysis, beoordeling: clientReports.beoordeling,
      clientName: clients.name, logoUrl: clients.logoUrl,
    })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .where(and(eq(clientReports.id, reportId), isNull(clientReports.deletedAt)))
    .limit(1);
  if (!r) return null;
  const analysis = r.analysis && Object.keys(r.analysis).length ? (r.analysis as unknown as MonthlyAnalysis) : null;
  const b = (r.beoordeling ?? {}) as Beoordeling;
  return {
    clientId: r.clientId,
    status: r.status as ReportStatus,
    clientName: r.clientName,
    logoUrl: r.logoUrl,
    period: r.period,
    periodLabel: periodLabel(r.period),
    totals: (r.metrics ?? {}) as Record<string, unknown>,
    analysis,
    klanttekst: b.klanttekst ?? "",
  };
}

/** Portaal: gepubliceerde maandrapporten van de eigen klant (nieuwste eerst). */
export async function getPortalMonthlyReports(viewer: Viewer): Promise<Array<{ id: string; period: string; periodLabel: string; title: string; samenvatting: string; publishedAt: string | null }>> {
  if (!viewer.clientScope || viewer.clientScope.length === 0) return [];
  const clientId = viewer.isPortalUser ? viewer.clientScope[0]! : viewer.clientScope[0]!;
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
