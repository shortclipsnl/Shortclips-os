import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { listContentResearchOverview, listWeeklyIdeasByClient } from "@/server/content-research/service";
import { WeeklyTop } from "./weekly-top";
import { ClientLogoStrip } from "./client-logo-strip";
import { InfoNote, PageHeader } from "@/components/ui";
import { OverviewGrid } from "./overview-grid";

export const metadata: Metadata = { title: "AI Content Research" };
export const dynamic = "force-dynamic";

export default async function ContentResearchOverviewPage() {
  const viewer = await requirePermission("content_research:read");
  const [clients, weekly] = await Promise.all([listContentResearchOverview(viewer), listWeeklyIdeasByClient(viewer)]);
  const canWrite = viewer.permissions.has("content_research:write");
  const aiReady = aiConfigured();

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Content Research"
        description="Elke maandag per actieve klant vijf onderbouwde video-ideeën. Je ziet alleen de klanten waar je toegang toe hebt."
      />

      {!aiReady ? (
        <div className="mb-5">
          <InfoNote>De AI staat uit (ANTHROPIC_API_KEY ontbreekt). Onderzoek starten kan pas zodra de sleutel is ingesteld.</InfoNote>
        </div>
      ) : null}

      <ClientLogoStrip clients={clients.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, logoUrl: c.logoUrl, color: c.color, newIdeas: c.newIdeas }))} />

      <WeeklyTop groups={weekly} />

      {/* Alle klanten (onderzoek starten, niet-actieve klanten): ingeklapt, zodat
          de pagina draait om de ideeën van deze week. */}
      <details className="group">
        <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          Alle klanten en onderzoek starten ({clients.length})
        </summary>
        <div className="mt-4">
          <OverviewGrid clients={clients} canWrite={canWrite} />
        </div>
      </details>
    </div>
  );
}
