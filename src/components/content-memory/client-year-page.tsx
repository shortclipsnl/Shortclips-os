import type { Viewer } from "@/server/auth/context";
import { getClientYearMemory } from "@/server/content-memory/year";
import { getClientInsights } from "@/server/content-memory/client-insights-store";
import { ClientYearView } from "./client-year-view";
import { WhatWorks } from "./what-works";

/**
 * Het Contentgeheugen zoals de klant het ziet. Eén bron voor het klantportaal
 * en de interne weergave "Zo ziet de klant het", zodat die altijd gelijk zijn.
 */
export async function ClientYearMemoryPage({ viewer, clientId }: { viewer: Viewer; clientId: string }) {
  const data = await getClientYearMemory(viewer, clientId);
  if (!data) return <p className="text-sm text-[var(--color-ink-muted)]">Nog geen gegevens beschikbaar.</p>;
  // Alleen inzichten die het team heeft goedgekeurd, berekend over dezelfde periode.
  const insights = data.view.sufficient ? await getClientInsights(viewer, data.cm) : null;
  return <ClientYearView view={data.view}>{insights ? <WhatWorks insights={insights} /> : null}</ClientYearView>;
}
