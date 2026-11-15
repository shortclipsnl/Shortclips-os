import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { aiConfigured } from "@/server/ai/client";
import { listReportTeam } from "@/server/reports/service";
import { canApproveQuarter, getPublishedKlantRapport, getQuarterlyReport, isQuarterTeamReader, klantRapportVanWerkversie, requireQuarterAccess } from "@/server/quarterly/service";
import { RapportageTabs } from "../../rapportage-tabs";
import { QuarterDetailView } from "./quarter-detail";

export const metadata: Metadata = { title: "Kwartaalrapportage" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function KwartaalrapportPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireQuarterAccess();
  const { id } = await params;
  const detail = await getQuarterlyReport(viewer, id);
  if (!detail) notFound();
  const [werkversie, inPortaal, team] = await Promise.all([
    detail.metrics ? klantRapportVanWerkversie(id) : Promise.resolve(null),
    detail.portaalLooptAchter ? getPublishedKlantRapport(id) : Promise.resolve(null),
    listReportTeam().catch(() => []),
  ]);
  return (
    <div className="mx-auto max-w-[1200px]">
      <RapportageTabs active="kwartaal" />
      <Link href="/analytics/kwartaalrapportages" className="mb-3 flex w-fit items-center gap-1 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><ArrowLeft className="size-4" /> Alle kwartaalrapportages</Link>
      <QuarterDetailView
        d={detail}
        werkversie={werkversie}
        inPortaal={inPortaal}
        team={team.map((t) => ({ id: t.id, name: t.name }))}
        canWrite={viewer.permissions.has("reports:write")}
        canApprove={canApproveQuarter(viewer)}
        teamOnly={isQuarterTeamReader(viewer)}
        aiReady={aiConfigured()}
      />
    </div>
  );
}
