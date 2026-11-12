import "server-only";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientKnowledge, contentIdeas } from "@/db/schema";
import { loadPostAnalysis } from "./sources";

/**
 * Feedbacklus: Research → Idee → Script → Opname → Publicatie → Resultaten.
 *
 * Voor elk idee dat als script is opgeslagen (forwardedScriptId) zoeken we de
 * publicaties via de bestaande keten script → deliverable → publicatie, met de
 * laatste postmeting. Het resultaat komt op het idee te staan en (bij een
 * duidelijk sterk of zwak resultaat) als voorbeeld in het klantgeheugen. Daar
 * lezen zowel de Scriptgenerator als het volgende onderzoek uit: één bron, geen
 * derde database.
 *
 * Grens: de keten werkt alleen als het script in de scriptbibliotheek van het
 * portaal staat én de video aan dat script hangt. Een script dat alleen als PDF
 * in Drive staat, kan niet automatisch aan een publicatie gekoppeld worden.
 */
export async function syncIdeaOutcomes(): Promise<{ checked: number; linked: number; memory: number }> {
  const ideas = await db
    .select({ id: contentIdeas.id, clientId: contentIdeas.clientId, titel: contentIdeas.titel, scriptId: contentIdeas.forwardedScriptId })
    .from(contentIdeas)
    .where(and(isNotNull(contentIdeas.forwardedScriptId), isNull(contentIdeas.deletedAt)))
    .limit(500);
  if (ideas.length === 0) return { checked: 0, linked: 0, memory: 0 };

  const scriptIds = ideas.map((i) => i.scriptId!).filter(Boolean);
  const res = await db.execute(sql`
    select d.script_id as script_id, p.platform as platform, m.views as views
    from deliverables d
    join publications p on p.deliverable_id = d.id and p.deleted_at is null
    join lateral (
      select views from social_metrics sm where sm.publication_id = p.id order by sm.measured_on desc limit 1
    ) m on true
    where d.deleted_at is null and d.script_id in (${sql.join(scriptIds.map((id) => sql`${id}`), sql`, `)})
  `);
  const rows = ((res as unknown as { rows?: unknown[] }).rows ?? res) as Array<{ script_id: string; platform: string; views: number | string | null }>;

  const medianCache = new Map<string, Map<string, number>>();
  async function medians(clientId: string) {
    if (!medianCache.has(clientId)) {
      const a = await loadPostAnalysis(clientId).catch(() => null);
      medianCache.set(clientId, new Map((a?.platforms ?? []).map((p) => [p.platform, p.medianViews])));
    }
    return medianCache.get(clientId)!;
  }

  let linked = 0;
  let memory = 0;
  for (const idea of ideas) {
    const pubs = rows.filter((r) => r.script_id === idea.scriptId);
    if (pubs.length === 0) continue;
    const med = await medians(idea.clientId);
    const ratios = pubs
      .map((p) => {
        const m = med.get(String(p.platform).toLowerCase());
        return m && m > 0 ? Number(p.views ?? 0) / m : null;
      })
      .filter((x): x is number => x !== null);
    const relatief = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
    const views = pubs.reduce((s, p) => s + Number(p.views ?? 0), 0);
    await db
      .update(contentIdeas)
      .set({
        resultaat: {
          posts: pubs.length,
          views,
          relatief,
          platforms: [...new Set(pubs.map((p) => p.platform))],
          gemetenOp: new Date().toISOString(),
        } as unknown as Record<string, unknown>,
        status: "gebruikt",
        updatedAt: new Date(),
      })
      .where(eq(contentIdeas.id, idea.id));
    linked++;

    // Alleen duidelijke uitschieters gaan het klantgeheugen in.
    if (relatief != null && (relatief >= 1.5 || relatief <= 0.5)) {
      const title = `Content Research-idee: ${idea.titel}`.slice(0, 200);
      const [exists] = await db
        .select({ id: clientKnowledge.id })
        .from(clientKnowledge)
        .where(and(eq(clientKnowledge.clientId, idea.clientId), eq(clientKnowledge.title, title), isNull(clientKnowledge.deletedAt)))
        .limit(1);
      const body = `${relatief >= 1.5 ? "Presteerde boven" : "Presteerde onder"} het eigen gemiddelde: ${relatief.toFixed(1).replace(".", ",")}x de mediaan (${pubs.length} publicatie(s), ${views.toLocaleString("nl-NL")} weergaven). Bron: postmetingen, automatisch gekoppeld.`;
      if (exists) {
        await db.update(clientKnowledge).set({ body, updatedAt: new Date() }).where(eq(clientKnowledge.id, exists.id));
      } else {
        await db.insert(clientKnowledge).values({
          clientId: idea.clientId,
          category: relatief >= 1.5 ? "strong_example" : "weak_example",
          title,
          body,
          tags: ["content_research"] as unknown as Record<string, unknown>,
          source: "content_research",
        });
        memory++;
      }
    }
  }
  return { checked: ideas.length, linked, memory };
}
