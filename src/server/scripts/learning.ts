import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientKnowledge } from "@/db/schema";

/**
 * Leerlus: een goedgekeurd script is bewezen smaak. We bewaren het als
 * `strong_example` in het klantgeheugen (client_knowledge), zodat de
 * scriptgenerator én de scriptcontrole er automatisch van spiegelen bij een
 * volgend script (via clientLearnedText / getClientKnowledgeForAi). Nooit
 * blokkerend: een fout hier mag de goedkeuring niet tegenhouden.
 */
export async function rememberApprovedScript(input: {
  clientId: string;
  scriptId: string;
  title: string;
  hook: string | null;
  body: string | null;
  userId: string;
}): Promise<void> {
  const body = [
    input.hook ? `Hook: ${input.hook.trim()}` : "",
    input.body ? `Middenstuk: ${input.body.trim().slice(0, 800)}` : "",
  ].filter(Boolean).join("\n");
  if (!body) return;

  const tag = `script:${input.scriptId}`;
  // Eerdere auto-note voor ditzelfde script intrekken (geen dubbels bij her-goedkeuren).
  const existing = await db
    .select({ id: clientKnowledge.id, tags: clientKnowledge.tags })
    .from(clientKnowledge)
    .where(and(eq(clientKnowledge.clientId, input.clientId), eq(clientKnowledge.category, "strong_example"), eq(clientKnowledge.source, "generator"), isNull(clientKnowledge.deletedAt)));
  for (const r of existing) {
    if (Array.isArray(r.tags) && (r.tags as string[]).includes(tag)) {
      await db.update(clientKnowledge).set({ deletedAt: new Date() }).where(eq(clientKnowledge.id, r.id));
    }
  }

  await db.insert(clientKnowledge).values({
    clientId: input.clientId,
    category: "strong_example",
    title: `Goedgekeurd script: ${input.title}`.slice(0, 200),
    body,
    tags: ["strong_example", tag],
    source: "generator",
    isPinned: false,
    createdById: input.userId,
  });
}
