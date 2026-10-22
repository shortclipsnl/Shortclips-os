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
        description="De vaste Shortclips scriptschrijver voor organische short video's (TikTok/Reels). Kies een klant en het aantal scripts — hij schrijft ze direct volgens het Scripthandboek, op basis van wat bij die klant werkt. Daarna pas je alles aan en download je het als scriptbestand (PDF) in de vaste huisstijl."
      />
      <ScriptGeneratorChat clients={clients} aiReady={aiConfigured()} />
    </div>
  );
}
