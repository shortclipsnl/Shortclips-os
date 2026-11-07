import type { Metadata } from "next";
import { isOwner } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { currentMonthPeriod, previousMonthPeriod } from "@/server/reports/analysis";
import { listMonthlyReports, requireReportsAccess } from "@/server/reports/service";
import { PageHeader } from "@/components/ui";
import { ReportList } from "./report-list";

export const metadata: Metadata = { title: "AI Maandrapportages" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function MaandrapportagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireReportsAccess();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const overview = await listMonthlyReports(viewer);
  const canWrite = viewer.permissions.has("reports:write");
  const vorigeMaand = previousMonthPeriod(currentMonthPeriod());

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="AI Maandrapportages"
        description={overview.teamOnly
          ? "De goedgekeurde maandrapportages van onze klanten. Neem de inzichten door, markeer ze als doorgenomen en pak de acties op."
          : "Per klant per maand: AI stelt de analyse op uit de gemeten cijfers, Jarno controleert en keurt goed, het team neemt de inzichten door en zet ze om in acties."}
      />
      <ReportList
        overview={overview}
        viewerId={viewer.id}
        canWrite={canWrite}
        owner={isOwner(viewer)}
        aiReady={aiConfigured()}
        vorigeMaand={vorigeMaand}
        initial={{ maand: one("maand"), status: one("status"), weergave: one("weergave"), klantstatus: one("klantstatus"), klant: one("klant") }}
      />
    </div>
  );
}
