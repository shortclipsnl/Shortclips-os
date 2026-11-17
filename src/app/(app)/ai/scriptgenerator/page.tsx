import type { Metadata } from "next";
import { requirePermission, hasClientAccess } from "@/server/auth/context";
import { listClientsForScripts } from "@/server/ai/knowledge";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { AdviceBrief } from "@/components/content-memory/advice-brief";
import { ScriptGeneratorChat } from "./scriptgenerator-ui";

export const metadata: Metadata = { title: "Scriptgenerator" };
export const dynamic = "force-dynamic";
// Een scriptbeurt kan langer duren: het model schrijft én beoordeelt/herschrijft
// elk script tot minimaal 8/10. Ruim de tijd geven.
export const maxDuration = 300;

export default async function ScriptGeneratorPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const viewer = await requirePermission("ai:read");
  const clients = await listClientsForScripts(viewer);
  const { client } = await searchParams;
  // Vanaf de scriptingpagina kan een klant worden voorgeselecteerd (?client=<id>).

  // Contentadvies van de voorgeselecteerde klant: wat doen, wat laten, wat testen.
  const brief = client && hasClientAccess(viewer, client)
    ? await (async () => {
        const { loadClientMemory } = await import("@/server/content-memory");
        const { loadClientAdvice } = await import("@/server/content-memory/advice-store");
        const cm = await loadClientMemory(client);
        if (!cm?.memory.videoCount) return null;
        return { cm, advice: (await loadClientAdvice(cm, { sync: false })).advice };
      })().catch(() => null)
    : null;

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Scriptgenerator"
        description="De vaste Shortclips scriptschrijver voor organische short video's (TikTok/Reels). Kies een klant en het aantal scripts — hij schrijft ze direct volgens het Scripthandboek, op basis van wat bij die klant werkt. Daarna pas je alles aan en download je het als scriptbestand (PDF) in de vaste huisstijl."
      />
      {brief ? <AdviceBrief clientName={brief.cm.clientName} clientSlug={brief.cm.clientSlug} advice={brief.advice} /> : null}
      <ScriptGeneratorChat clients={clients} aiReady={aiConfigured()} initialClientId={client} />
    </div>
  );
}
