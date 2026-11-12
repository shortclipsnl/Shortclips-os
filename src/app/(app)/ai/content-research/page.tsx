import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { listContentResearchOverview, listWeeklyTopIdeas } from "@/server/content-research/service";
import { WeeklyTop } from "./weekly-top";
import { InfoNote, PageHeader } from "@/components/ui";
import { OverviewGrid } from "./overview-grid";

export const metadata: Metadata = { title: "AI Content Research" };
export const dynamic = "force-dynamic";

export default async function ContentResearchOverviewPage() {
  const viewer = await requirePermission("content_research:read");
  const [clients, weekly] = await Promise.all([listContentResearchOverview(viewer), listWeeklyTopIdeas(viewer)]);
  const canWrite = viewer.permissions.has("content_research:write");
  const aiReady = aiConfigured();

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Content Research"
        description="Elke maandag automatisch per actieve klant: eigen resultaten, eerdere scripts, concurrenten en het klantgeheugen samen, vertaald naar onderbouwde video-ideeën. Je ziet alleen de klanten waar je toegang toe hebt."
      />

      {!aiReady ? (
        <div className="mb-5">
          <InfoNote>De AI staat uit (ANTHROPIC_API_KEY ontbreekt). Onderzoek starten kan pas zodra de sleutel is ingesteld.</InfoNote>
        </div>
      ) : null}

      <WeeklyTop ideas={weekly} />

      <OverviewGrid clients={clients} canWrite={canWrite} />
    </div>
  );
}
