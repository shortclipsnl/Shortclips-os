import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { getMonthlyReport } from "@/server/reports/service";
import { loadStrategyProfile, GOAL_OPTIONS } from "@/server/reports/strategy";
import { ClientLogo, PageHeader } from "@/components/ui";
import { ReviewUI } from "./review-ui";
import { StrategyEditor } from "./strategy-editor";

export const metadata: Metadata = { title: "Maandrapportage controleren" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ReportReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requirePermission("reports:read");
  const { id } = await params;
  const report = await getMonthlyReport(viewer, id);
  if (!report) notFound();
  const canWrite = viewer.permissions.has("reports:write");
  const strategy = await loadStrategyProfile(report.clientId);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        breadcrumb={<Link href="/analytics/maandrapportages" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← Maandrapportages</Link>}
        title={<span className="flex items-center gap-2"><ClientLogo name={report.clientName} logoUrl={report.logoUrl} size={26} /> {report.clientName}</span>}
        description={<span className="capitalize">{report.periodLabel}{report.pmName ? ` · ${report.pmName}` : ""}</span>}
      />
      <StrategyEditor clientId={report.clientId} primaryGoal={strategy.primaryGoal} secondaryGoals={strategy.secondaryGoals} strategyNote={strategy.strategyNote} goalOptions={GOAL_OPTIONS} canWrite={canWrite} />
      <ReviewUI report={report} canWrite={canWrite} aiReady={aiConfigured()} />
    </div>
  );
}
