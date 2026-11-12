import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isOwner } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { getMonthlyReport, listReportTeam, loadReportPdfData, requireReportsAccess } from "@/server/reports/service";
import { loadStrategyProfile, GOAL_OPTIONS } from "@/server/reports/strategy";
import { Badge, ClientLogo, PageHeader } from "@/components/ui";
import { cijfersDefinitief, maandCompleetVanaf } from "@/lib/maandcontrole";
import { ReviewUI } from "./review-ui";
import { StrategyEditor } from "./strategy-editor";

export const metadata: Metadata = { title: "Maandrapportage" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ReportReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireReportsAccess();
  const { id } = await params;
  const report = await getMonthlyReport(viewer, id);
  if (!report) notFound();
  const canWrite = viewer.permissions.has("reports:write");
  const [strategy, team, pdfData] = await Promise.all([
    canWrite ? loadStrategyProfile(report.clientId) : Promise.resolve(null),
    listReportTeam(),
    loadReportPdfData(report.id),
  ]);
  const videos = (pdfData?.videos ?? []).map((v) => ({
    key: v.key, id: v.id, titel: v.titel, datum: v.datum, platform: v.platform, views: v.views, likes: v.likes, reacties: v.reacties,
    shares: v.shares, saves: v.saves, gemKijktijdSec: v.gemKijktijdSec, uitkijkPct: v.uitkijkPct ?? null, duurSec: v.duurSec ?? null,
    scriptHook: v.scriptHook ?? null, thumb: v.thumb, analyse: v.analyse,
  }));

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        breadcrumb={<Link href={`/analytics/maandrapportages?maand=${report.period}`} className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← Maandrapportages</Link>}
        title={<span className="flex items-center gap-2"><ClientLogo name={report.clientName} logoUrl={report.logoUrl} size={26} /> {report.clientName} {!report.clientActive ? <Badge tone="neutral">Inactieve klant</Badge> : null}</span>}
        description={<span className="capitalize">{report.periodLabel}{report.pmName ? ` · ${report.pmName}` : ""}</span>}
      />
      {canWrite && report.generatedAt && !cijfersDefinitief(report.period, report.generatedAt) && report.status !== "goedgekeurd" && report.status !== "gepubliceerd" ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-warn)]/50 bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[#8a5300]">
          <b>Voorlopige cijfers.</b> Deze rapportage is gemaakt op {new Date(report.generatedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })}, voordat de maand compleet was. Je kunt hem al voorbereiden en controleren. Vanaf {new Date(`${maandCompleetVanaf(report.period)}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "UTC" })} worden de cijfers automatisch ververst met de volledige maand; je beoordeling blijft staan. Goedkeuren en versturen kan pas daarna.
          {report.ontbrekend.length ? <> Ontbrekende gegevens: {report.ontbrekend.join("; ")}.</> : null}
        </div>
      ) : null}
      {canWrite && strategy ? <StrategyEditor clientId={report.clientId} primaryGoal={strategy.primaryGoal} secondaryGoals={strategy.secondaryGoals} strategyNote={strategy.strategyNote} goalOptions={GOAL_OPTIONS} canWrite={canWrite} /> : null}
      <ReviewUI
        report={report}
        canWrite={canWrite}
        owner={isOwner(viewer)}
        canTask={viewer.permissions.has("tasks:write")}
        viewerId={viewer.id}
        team={team.map((t) => ({ id: t.id, name: t.name }))}
        aiReady={aiConfigured()}
        videos={videos}
      />
    </div>
  );
}
