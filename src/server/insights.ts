import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiOutputs, clients, deliverables } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";
import { getClientReport } from "@/server/client-report";

export type Finding = { punt: string; zekerheid: "bewezen" | "waarschijnlijk" | "hypothese" };
export type Recommendation = {
  titel: string;
  waarom: string;
  wat: string;
  hoeMeten: string;
  zekerheid: "bewezen" | "waarschijnlijk" | "hypothese";
};
export type ClientInsights = {
  analysis: { watWerkt: Finding[]; watMinder: Finding[]; ontwikkelingen: string[] };
  verbeterpunten: Recommendation[];
};

const SYSTEM = `Je bent een senior short-video strateeg bij Shortclips. Je analyseert de resultaten van één klant en geeft concrete, klantspecifieke verbeterpunten voor de volgende opnames.

Strikte regels:
- Baseer ALLES uitsluitend op de meegeleverde cijfers en content. Verzin niets.
- Er zijn GEEN cijfers per video beschikbaar (geen retentie, geen per-post views). Trek daarom NOOIT conclusies over hooks, retentie, kijktijd of conversie — tenzij dat direct uit de meegeleverde data blijkt. Markeer zulke uitspraken anders als "hypothese".
- Label elk analysepunt met zekerheid: "bewezen" (volgt direct uit de cijfers), "waarschijnlijk" (aannemelijk maar niet hard), of "hypothese" (te testen).
- Verbeterpunten moeten concreet en specifiek voor DEZE klant zijn, niet algemeen. Elk verbeterpunt: titel, waarom (onderbouwd met de data), wat we aanpassen, en hoe we later meten of het werkte.
- Schrijf in het Nederlands, zakelijk en bondig.
- Antwoord UITSLUITEND met geldige JSON in exact dit formaat:
{"analysis":{"watWerkt":[{"punt":"...","zekerheid":"bewezen|waarschijnlijk|hypothese"}],"watMinder":[{"punt":"...","zekerheid":"..."}],"ontwikkelingen":["..."]},"verbeterpunten":[{"titel":"...","waarom":"...","wat":"...","hoeMeten":"...","zekerheid":"..."}]}`;

/** Bouwt de AI-analyse voor een klant uit de echte cijfers en slaat die op.
 *  Gated: zonder ANTHROPIC_API_KEY gebeurt er niets (nette melding). */
export async function generateClientInsights(slug: string, days = 90): Promise<
  { ok: true; insights: ClientInsights; model: string } | { ok: false; reason: "no_provider" | "no_data" | "error"; message?: string }
> {
  const viewer = await requireInternal();
  if (!aiConfigured()) return { ok: false, reason: "no_provider" };

  const r = await getClientReport(slug, days);
  if (!r.hasData) return { ok: false, reason: "no_data", message: "Nog geen resultaten om te analyseren." };

  // Recente videotitels als contentcontext (geen per-video cijfers beschikbaar).
  const titles = await db
    .select({ title: deliverables.title })
    .from(deliverables)
    .where(and(eq(deliverables.clientId, r.client.id), isNull(deliverables.deletedAt)))
    .orderBy(desc(deliverables.createdAt))
    .limit(30);

  const dataBlock = {
    klant: r.client.name,
    periodeDagen: days,
    cijfers: r.totals,
    perPlatform: r.perPlatform,
    perMaand: r.months,
    feitelijkeObservaties: r.observations,
    recenteVideotitels: titles.map((t) => t.title),
  };

  const res = await runJsonPrompt<ClientInsights>({
    system: SYSTEM,
    user: `Analyseer deze klant en geef verbeterpunten. Data (JSON):\n${JSON.stringify(dataBlock)}`,
    maxTokens: 4000,
  });
  if (!res.ok) return { ok: false, reason: res.reason === "no_provider" ? "no_provider" : "error", message: res.error };

  const insights = res.data;
  await db.insert(aiOutputs).values({
    clientId: r.client.id,
    tool: "insights",
    title: `Resultatenanalyse (${days} dagen)`,
    inputSummary: `${r.totals.views} weergaven · ${r.totals.posts} video's · ${days} dagen`,
    output: insights as unknown as Record<string, unknown>,
    createdById: viewer.id,
  });

  return { ok: true, insights, model: res.model };
}

/** Laatst opgeslagen AI-analyse voor een klant (voor pagina en PDF). */
export async function getLatestInsights(clientId: string): Promise<{ insights: ClientInsights; createdAt: Date } | null> {
  const [row] = await db
    .select({ output: aiOutputs.output, createdAt: aiOutputs.createdAt })
    .from(aiOutputs)
    .where(and(eq(aiOutputs.clientId, clientId), eq(aiOutputs.tool, "insights")))
    .orderBy(desc(aiOutputs.createdAt))
    .limit(1);
  if (!row) return null;
  return { insights: row.output as unknown as ClientInsights, createdAt: row.createdAt as Date };
}

/** Of de AI-koppeling actief is (voor de UI). */
export function insightsAvailable(): boolean {
  return aiConfigured();
}
