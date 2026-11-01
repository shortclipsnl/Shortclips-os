import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { listActiveClientsForAi } from "@/server/ai/knowledge";
import { listMonthlyReports } from "@/server/reports/service";
import { PageHeader, Stat } from "@/components/ui";
import { ReportList } from "./report-list";

export const metadata: Metadata = { title: "AI Maandrapportages" };
export const dynamic = "force-dynamic";

export default async function MaandrapportagesPage() {
  const viewer = await requirePermission("reports:read");
  const [{ reports, stats }, activeClients] = await Promise.all([
    listMonthlyReports(viewer),
    listActiveClientsForAi(viewer),
  ]);
  const canWrite = viewer.permissions.has("reports:write");

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Maandrapportages"
        description="AI stelt per klant de maandanalyse op uit de échte cijfers; jij controleert, voegt je persoonlijke blik toe en keurt goed. Daarna verschijnt de premium PDF in het klantportaal."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Deze maand" value={stats.dezeMaand} />
        <Stat label="Te controleren" value={stats.teControleren} tone={stats.teControleren > 0 ? "warn" : "neutral"} />
        <Stat label="Goedgekeurd" value={stats.goedgekeurd} tone="good" />
        <Stat label="Gepubliceerd" value={stats.gepubliceerd} tone="lime" />
        <Stat label="Ontbrekende data" value={stats.ontbrekendeGegevens} tone={stats.ontbrekendeGegevens > 0 ? "warn" : "neutral"} />
      </div>

      <ReportList reports={reports} activeClients={activeClients.map((c) => ({ id: c.id, name: c.name }))} viewerId={viewer.id} canWrite={canWrite} aiReady={aiConfigured()} />
    </div>
  );
}
