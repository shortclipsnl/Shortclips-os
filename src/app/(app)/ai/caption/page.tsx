import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { listActiveClientsForAi, listAiOutputs } from "@/server/ai/knowledge";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { CaptionMaker } from "./caption-ui";
import type { ShortCaption } from "@/server/actions/ai-tools";

export const metadata: Metadata = { title: "Caption Maker" };
export const dynamic = "force-dynamic";
// AI-generatie kan (bij meerdere shorts / een grote PDF) tientallen seconden duren.
// Zonder deze langere functie-timeout wordt de generatie op Vercel afgekapt →
// foutmelding. Gelijk aan de scriptgenerator.
export const maxDuration = 300;

export default async function CaptionPage() {
  const viewer = await requirePermission("ai:read");
  const [clients, outputs] = await Promise.all([
    listActiveClientsForAi(viewer),
    listAiOutputs(viewer, "caption"),
  ]);
  const recent = outputs.map((o) => ({
    id: o.id,
    title: o.title,
    clientName: o.clientName,
    createdAt: o.createdAt.toISOString(),
    output: o.output as ShortCaption[],
  }));

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Caption Maker"
        description="Sleep het scriptbestand erin en kies de klant — je krijgt per short één caption voor Instagram, TikTok, Facebook en YouTube Shorts, met eventueel toepasbare hashtags."
      />
      <CaptionMaker clients={clients} aiReady={aiConfigured()} recent={recent} />
    </div>
  );
}
