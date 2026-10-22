import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { listActiveClientsForAi } from "@/server/ai/knowledge";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { ScriptGeneratorChat } from "./scriptgenerator-ui";

export const metadata: Metadata = { title: "Scriptgenerator" };
export const dynamic = "force-dynamic";
// Een scriptbeurt kan meerdere seconden duren; ruim de tijd geven.
export const maxDuration = 120;

export default async function ScriptGeneratorPage() {
  const viewer = await requirePermission("ai:read");
  const clients = await listActiveClientsForAi(viewer);

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Scriptgenerator"
        description="De vaste Shortclips scriptschrijver voor organische short video's (TikTok/Reels). Schrijft volgens het Scripthandboek, leert van wat bij jullie klanten werkt, en levert op in het vaste Shortclips-format. Kies een klant om de stijl en cijfers mee te laden."
      />
      <ScriptGeneratorChat clients={clients} aiReady={aiConfigured()} />
    </div>
  );
}
