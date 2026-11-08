import type { Metadata } from "next";
import { isOwner } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { currentMonthPeriod, previousMonthPeriod } from "@/server/reports/analysis";
import { listMonthlyReports, requireReportsAccess } from "@/server/reports/service";
import { PageHeader } from "@/components/ui";
import { ReportList } from "./report-list";

export const metadata: Metadata = { title: "Maandrapportages" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function MaandrapportagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireReportsAccess();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const overview = await listMonthlyReports(viewer);
  const canWrite = viewer.permissions.has("reports:write");
  const huidigeMaand = currentMonthPeriod();
  const vorigeMaand = previousMonthPeriod(huidigeMaand);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Maandrapportages"
        description={overview.teamOnly
          ? "De goedgekeurde maandrapportages van onze klanten. Open de interne versie, neem de inzichten door en pak de acties op."
          : "Per klant per maand een interne versie en een klantversie. Genereren, controleren, goedkeuren en publiceren doe je hier, direct vanuit de tabel."}
      />
      <ReportList
        overview={overview}
        viewerId={viewer.id}
        canWrite={canWrite}
        owner={isOwner(viewer)}
        aiReady={aiConfigured()}
        vorigeMaand={vorigeMaand}
        huidigeMaand={huidigeMaand}
        initial={{ maand: one("maand"), status: one("status"), weergave: one("weergave"), klantstatus: one("klantstatus"), klant: one("klant"), zoek: one("zoek") }}
      />
    </div>
  );
}
