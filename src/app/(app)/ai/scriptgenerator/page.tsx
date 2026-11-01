import type { Metadata } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { contentIdeas } from "@/db/schema";
import { requirePermission, hasClientAccess } from "@/server/auth/context";
import { listClientsForScripts } from "@/server/ai/knowledge";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { ScriptGeneratorChat } from "./scriptgenerator-ui";

export const metadata: Metadata = { title: "Scriptgenerator" };
export const dynamic = "force-dynamic";
// Een scriptbeurt kan langer duren: het model schrijft én beoordeelt/herschrijft
// elk script tot minimaal 8/10. Ruim de tijd geven.
export const maxDuration = 300;

/** Bouwt een voorgevulde brief uit een Content Research-idee. */
async function briefFromIdea(viewer: Awaited<ReturnType<typeof requirePermission>>, ideaId: string): Promise<string | undefined> {
  const [idea] = await db
    .select({ clientId: contentIdeas.clientId, titel: contentIdeas.titel, concept: contentIdeas.concept, hooks: contentIdeas.hooks, inspiratieUrl: contentIdeas.inspiratieUrl })
    .from(contentIdeas)
    .where(and(eq(contentIdeas.id, ideaId), isNull(contentIdeas.deletedAt)))
    .limit(1);
  if (!idea || !hasClientAccess(viewer, idea.clientId)) return undefined;
  const hooks = Array.isArray(idea.hooks) ? (idea.hooks as string[]) : [];
  const lines = [
    `Onderwerp: ${idea.titel}`,
    idea.concept ? `Concept: ${idea.concept}` : "",
    hooks.length ? `Mogelijke hooks:\n- ${hooks.join("\n- ")}` : "",
    idea.inspiratieUrl ? `Inspiratiebron: ${idea.inspiratieUrl}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export default async function ScriptGeneratorPage({ searchParams }: { searchParams: Promise<{ client?: string; idea?: string }> }) {
  const viewer = await requirePermission("ai:read");
  const clients = await listClientsForScripts(viewer);
  const { client, idea } = await searchParams;
  // Vanaf de scriptingpagina of Content Research kan een klant worden
  // voorgeselecteerd (?client=<id>) en een idee worden doorgegeven (?idea=<id>).
  const initialBrief = idea ? await briefFromIdea(viewer, idea) : undefined;

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Scriptgenerator"
        description="De vaste Shortclips scriptschrijver voor organische short video's (TikTok/Reels). Kies een klant en het aantal scripts — hij schrijft ze direct volgens het Scripthandboek, op basis van wat bij die klant werkt. Daarna pas je alles aan en download je het als scriptbestand (PDF) in de vaste huisstijl."
      />
      <ScriptGeneratorChat clients={clients} aiReady={aiConfigured()} initialClientId={client} initialBrief={initialBrief} />
    </div>
  );
}
