import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isOwner } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { getMonthlyReport, listReportTeam, requireReportsAccess } from "@/server/reports/service";
import { loadStrategyProfile, GOAL_OPTIONS } from "@/server/reports/strategy";
import { Badge, ClientLogo, PageHeader } from "@/components/ui";
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
  const [strategy, team] = await Promise.all([
    canWrite ? loadStrategyProfile(report.clientId) : Promise.resolve(null),
    listReportTeam(),
  ]);

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        breadcrumb={<Link href={`/analytics/maandrapportages?maand=${report.period}`} className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← Maandrapportages</Link>}
        title={<span className="flex items-center gap-2"><ClientLogo name={report.clientName} logoUrl={report.logoUrl} size={26} /> {report.clientName} {!report.clientActive ? <Badge tone="neutral">Inactieve klant</Badge> : null}</span>}
        description={<span className="capitalize">{report.periodLabel}{report.pmName ? ` · ${report.pmName}` : ""}</span>}
      />
      {canWrite && strategy ? <StrategyEditor clientId={report.clientId} primaryGoal={strategy.primaryGoal} secondaryGoals={strategy.secondaryGoals} strategyNote={strategy.strategyNote} goalOptions={GOAL_OPTIONS} canWrite={canWrite} /> : null}
      <ReviewUI
        report={report}
        canWrite={canWrite}
        owner={isOwner(viewer)}
        canTask={viewer.permissions.has("tasks:write")}
        viewerId={viewer.id}
        team={team.map((t) => ({ id: t.id, name: t.name }))}
        aiReady={aiConfigured()}
      />
    </div>
  );
}
