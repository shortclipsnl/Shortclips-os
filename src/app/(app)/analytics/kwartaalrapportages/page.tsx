import type { Metadata } from "next";
import { aiConfigured } from "@/server/ai/client";
import { canApproveQuarter, listQuarterlyReports, requireQuarterAccess } from "@/server/quarterly/service";
import { PageHeader } from "@/components/ui";
import { RapportageTabs } from "../rapportage-tabs";
import { QuarterList } from "./quarter-list";

export const metadata: Metadata = { title: "Kwartaalrapportages" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function KwartaalrapportagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireQuarterAccess();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const overview = await listQuarterlyReports(viewer);
  const actie = overview.rows.filter((r) => r.mijn && r.status !== "gepubliceerd" && r.status !== "gepland").length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <RapportageTabs active="kwartaal" kwartaalActie={actie} />
      <PageHeader
        title="Kwartaalrapportages"
        description={overview.teamOnly
          ? "De goedgekeurde kwartaalrapportages van onze klanten. Open de interne versie en neem de inzichten door."
          : "Per klant per kwartaal een strategische rapportage: een interne versie en een klantversie. De voorbereiding start vanzelf; jij controleert, vult aan en keurt goed."}
      />
      <QuarterList
        overview={overview}
        viewerId={viewer.id}
        canWrite={viewer.permissions.has("reports:write")}
        canApprove={canApproveQuarter(viewer)}
        aiReady={aiConfigured()}
        initial={{ status: one("status"), weergave: one("weergave"), klant: one("klant"), jaar: one("jaar"), kwartaal: one("kwartaal"), medewerker: one("medewerker"), klantstatus: one("klantstatus") }}
      />
    </div>
  );
}
