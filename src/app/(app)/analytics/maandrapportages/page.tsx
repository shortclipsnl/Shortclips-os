import type { Metadata } from "next";
import { isOwner } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { currentMonthPeriod } from "@/server/reports/analysis";
import { actueleRapportMaand, laatsteWerkdag, maandCompleet, maandCompleetVanaf } from "@/lib/maandcontrole";
import { nlHolidaySet } from "@/lib/holidays";
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
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const jaar = Number(today.slice(0, 4));
  const holidays = nlHolidaySet([jaar - 1, jaar, jaar + 1]);
  // Bovenaan staat altijd de actuele maand: vanaf de laatste werkdag de lopende
  // maand, daarvoor de vorige (waarvan controle en goedkeuring nog lopen).
  const actueleMaand = actueleRapportMaand(today, holidays);
  const planning = {
    controleDag: laatsteWerkdag(actueleMaand, holidays),
    definitiefVanaf: maandCompleetVanaf(actueleMaand),
    compleet: maandCompleet(actueleMaand, today),
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Maandrapportages"
        description={overview.teamOnly
          ? "De goedgekeurde maandrapportages van onze klanten. Open de interne versie, neem de inzichten door en pak de acties op."
          : "Per klant per maand een interne versie en een klantversie. Controleren, goedkeuren en versturen doe je hier, direct vanuit de tabel."}
      />
      <ReportList
        overview={overview}
        viewerId={viewer.id}
        canWrite={canWrite}
        owner={isOwner(viewer)}
        aiReady={aiConfigured()}
        actueleMaand={actueleMaand}
        huidigeMaand={huidigeMaand}
        huidigOpen={today >= laatsteWerkdag(huidigeMaand, holidays)}
        planning={planning}
        initial={{ maand: one("maand"), status: one("status"), weergave: one("weergave"), klantstatus: one("klantstatus"), klant: one("klant"), zoek: one("zoek") }}
      />
    </div>
  );
}
