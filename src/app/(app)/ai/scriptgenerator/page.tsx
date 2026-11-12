import type { Metadata } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { contentIdeas } from "@/db/schema";
import { requirePermission, hasClientAccess } from "@/server/auth/context";
import { listClientsForScripts } from "@/server/ai/knowledge";
import { aiConfigured } from "@/server/ai/client";
import { InfoNote, PageHeader } from "@/components/ui";
import { clientLearnedText } from "@/server/ai/knowledge";
import { loadCompetitors, loadPriorScripts } from "@/server/content-research/sources";
import { ScriptGeneratorChat } from "./scriptgenerator-ui";

export const metadata: Metadata = { title: "Scriptgenerator" };
export const dynamic = "force-dynamic";
// Een scriptbeurt kan langer duren: het model schrijft én beoordeelt/herschrijft
// elk script tot minimaal 8/10. Ruim de tijd geven.
export const maxDuration = 300;

/**
 * Bouwt de voorgevulde, bewerkbare brief uit een Content Research-idee: alles
 * wat het team anders zou overtypen (concept, hook, invalshoek, onderbouwing,
 * concurrentvoorbeelden, eerdere scripts over hetzelfde onderwerp en het
 * klantgeheugen). De medewerker past dit aan vóór er een script wordt gemaakt.
 */
async function briefFromIdea(
  viewer: Awaited<ReturnType<typeof requirePermission>>,
  ideaId: string,
  hookIndex = 0,
): Promise<{ brief: string; existing: { scriptLink: string | null; hasLibraryScript: boolean } } | undefined> {
  const [idea] = await db
    .select()
    .from(contentIdeas)
    .where(and(eq(contentIdeas.id, ideaId), isNull(contentIdeas.deletedAt)))
    .limit(1);
  if (!idea || !hasClientAccess(viewer, idea.clientId)) return undefined;

  const [competitors, prior, memory] = await Promise.all([
    loadCompetitors(idea.clientId).catch(() => []),
    loadPriorScripts(idea.clientId).catch(() => ({ count: 0, recent: [], texts: [] })),
    clientLearnedText(idea.clientId).catch(() => ""),
  ]);

  const allHooks = Array.isArray(idea.hooks) ? (idea.hooks as string[]) : [];
  // De in Content Research gekozen hook komt eerst, de andere als alternatief.
  const chosen = allHooks[hookIndex] ?? allHooks[0];
  const hooks = chosen ? [chosen, ...allHooks.filter((h) => h !== chosen)] : [];
  const middenstuk = Array.isArray(idea.middenstuk) ? (idea.middenstuk as string[]) : [];
  const evidence = Array.isArray(idea.onderbouwing) ? (idea.onderbouwing as Array<{ type: string; tekst: string; zekerheid: string; url: string | null }>) : [];

  // Eerdere scripts over een vergelijkbaar onderwerp: simpele woordovereenkomst
  // tussen de ideetitel en de bestandsnamen in Drive.
  const words = idea.titel.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter((w) => w.length > 3);
  const similar = prior.recent
    .map((s) => ({ s, hits: words.filter((w) => s.name.toLowerCase().includes(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3)
    .map((x) => x.s);

  const compExamples = competitors
    .filter((c) => c.actief && c.laatsteObservatie)
    .slice(0, 2)
    .map((c) => `- ${c.naam}: ${c.laatsteObservatie!.slice(0, 300)}`);

  const lines = [
    `Onderwerp: ${idea.titel}`,
    idea.concept ? `Concept: ${idea.concept}` : "",
    hooks[0] ? `Gekozen hook: ${hooks[0]}` : "",
    hooks.length > 1 ? `Alternatieve hooks:\n- ${hooks.slice(1).join("\n- ")}` : "",
    middenstuk.length ? `Middenstuk, dit moet erin:\n- ${middenstuk.join("\n- ")}` : "",
    idea.cta ? `Call to action: ${idea.cta}` : "",
    idea.invalshoek ? `Creatieve invalshoek: ${idea.invalshoek}` : "",
    idea.doel ? `Doel van de video: ${idea.doel}` : "",
    evidence.length ? `Onderbouwing uit Content Research:\n${evidence.map((e) => `- (${e.zekerheid}) ${e.tekst}${e.url ? ` ${e.url}` : ""}`).join("\n")}` : idea.waaromWerkt ? `Waarom dit werkt: ${idea.waaromWerkt}` : "",
    compExamples.length ? `Voorbeelden bij concurrenten (inspiratie, niet kopiëren):\n${compExamples.join("\n")}` : "",
    similar.length ? `Eerdere scripts over een vergelijkbaar onderwerp (niet herhalen, wel van leren):\n${similar.map((s) => `- ${s.name}`).join("\n")}` : "",
    memory ? `Uit het klantgeheugen:\n${memory.split("\n").slice(0, 6).join("\n")}` : "",
    idea.inspiratieUrl ? `Inspiratiebron: ${idea.inspiratieUrl}` : "",
  ].filter(Boolean);
  return {
    brief: lines.join("\n\n"),
    existing: { scriptLink: idea.scriptLink, hasLibraryScript: Boolean(idea.forwardedScriptId) },
  };
}

export default async function ScriptGeneratorPage({ searchParams }: { searchParams: Promise<{ client?: string; idea?: string; hook?: string }> }) {
  const viewer = await requirePermission("ai:read");
  const clients = await listClientsForScripts(viewer);
  const { client, idea, hook } = await searchParams;
  // Vanaf de scriptingpagina of Content Research kan een klant worden
  // voorgeselecteerd (?client=<id>) en een idee worden doorgegeven (?idea=<id>).
  const fromIdea = idea ? await briefFromIdea(viewer, idea, Math.max(0, Math.min(4, Number(hook) || 0))) : undefined;

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Scriptgenerator"
        description="De vaste Shortclips scriptschrijver voor organische short video's (TikTok/Reels). Kies een klant en het aantal scripts — hij schrijft ze direct volgens het Scripthandboek, op basis van wat bij die klant werkt. Daarna pas je alles aan en download je het als scriptbestand (PDF) in de vaste huisstijl."
      />
      {fromIdea && (fromIdea.existing.scriptLink || fromIdea.existing.hasLibraryScript) ? (
        <div className="mb-4">
          <InfoNote>
            Voor dit idee is al een script gemaakt
            {fromIdea.existing.scriptLink ? (
              <> (<a href={fromIdea.existing.scriptLink} target="_blank" rel="noopener noreferrer" className="underline">open in Drive</a>)</>
            ) : " (staat in de scriptbibliotheek)"}
            . Genereer alleen opnieuw als je bewust een nieuwe versie wilt.
          </InfoNote>
        </div>
      ) : null}
      <ScriptGeneratorChat clients={clients} aiReady={aiConfigured()} initialClientId={client} initialBrief={fromIdea?.brief} initialIdeaId={fromIdea ? idea : undefined} />
    </div>
  );
}
