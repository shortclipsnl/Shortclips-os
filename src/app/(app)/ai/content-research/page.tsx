import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { listContentResearchOverview } from "@/server/content-research/service";
import { InfoNote, PageHeader } from "@/components/ui";
import { OverviewGrid } from "./overview-grid";

export const metadata: Metadata = { title: "AI Content Research" };
export const dynamic = "force-dynamic";

export default async function ContentResearchOverviewPage() {
  const viewer = await requirePermission("content_research:read");
  const clients = await listContentResearchOverview(viewer);
  const canWrite = viewer.permissions.has("content_research:write");
  const aiReady = aiConfigured();

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Content Research"
        description="Per klant continu, écht onderzoek naar trends en concurrenten, vertaald naar originele organische video-ideeën. Los van Video Intelligence (dat gepubliceerde video's analyseert)."
      />

      {!aiReady ? (
        <div className="mb-5">
          <InfoNote>De AI staat uit (ANTHROPIC_API_KEY ontbreekt). Onderzoek starten kan pas zodra de sleutel is ingesteld.</InfoNote>
        </div>
      ) : null}

      <OverviewGrid clients={clients} canWrite={canWrite} />
    </div>
  );
}
