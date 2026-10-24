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
- Er zijn GEEN cijfers per video beschikbaar (geen retentie, geen per-post views). Trek daarom NOOIT harde conclusies over hooks, retentie, kijktijd of conversie — tenzij dat direct uit de meegeleverde data blijkt. Markeer zulke uitspraken anders als "hypothese".
- Label elk analysepunt met zekerheid: "bewezen" (volgt direct uit de cijfers), "waarschijnlijk" (aannemelijk maar niet hard), of "hypothese" (te testen).
- Geef ALTIJD minimaal 3 en maximaal 5 verbeterpunten; het veld "verbeterpunten" mag NOOIT leeg zijn. Elk verbeterpunt is concreet en specifiek voor DEZE klant (niet algemeen) en heeft: titel, waarom (onderbouwd met de data), wat we aanpassen, en hoe we later meten of het werkte (hoeMeten), plus een zekerheidslabel.
- Schrijf in het Nederlands, zakelijk en bondig.

JSON-opmaak (STRIKT, anders is het antwoord onbruikbaar):
- Antwoord met UITSLUITEND één geldig JSON-object, zonder tekst eromheen en zonder markdown.
- Gebruik binnen tekstwaarden GEEN dubbele aanhalingstekens; gebruik indien nodig enkele aanhalingstekens.
- Gebruik GEEN letterlijke regeleinden binnen waarden en GEEN trailing komma's.
- Exact dit formaat:
{"analysis":{"watWerkt":[{"punt":"...","zekerheid":"bewezen|waarschijnlijk|hypothese"}],"watMinder":[{"punt":"...","zekerheid":"..."}],"ontwikkelingen":["..."]},"verbeterpunten":[{"titel":"...","waarom":"...","wat":"...","hoeMeten":"...","zekerheid":"..."}]}`;

/** Bouwt de AI-analyse voor een klant uit de echte cijfers en slaat die op.
 *  Gated: zonder ANTHROPIC_API_KEY gebeurt er niets (nette melding). */
export async function generateClientInsights(slug: string, days = 90, trusted = false): Promise<
  { ok: true; insights: ClientInsights; model: string } | { ok: false; reason: "no_provider" | "no_data" | "error"; message?: string }
> {
  // `trusted` = aangeroepen vanuit een vertrouwde server-job zonder sessie.
  const viewer = trusted ? null : await requireInternal();
  if (!aiConfigured()) return { ok: false, reason: "no_provider" };

  const r = await getClientReport(slug, days, trusted);
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
    // Ruim budget: de volledige analyse (watWerkt/watMinder/ontwikkelingen +
    // meerdere onderbouwde verbeterpunten) loopt al snel tegen de 4.500 tokens.
    // Bij 4.000 werd het JSON-antwoord afgekapt en faalde het parsen stilletjes,
    // waardoor er geen analyse werd opgeslagen. 8.000 laat het antwoord afmaken.
    maxTokens: 8000,
  });
  if (!res.ok) return { ok: false, reason: res.reason === "no_provider" ? "no_provider" : "error", message: res.error };

  // Normaliseer naar de verwachte vorm: AI-antwoorden wijken soms af (een
  // ontbrekende sleutel, een andere naam). Zo is wat we opslaan én tonen altijd
  // renderbaar en crasht de pagina nooit op een afwijkend model-antwoord.
  const raw = (res.data ?? {}) as Partial<ClientInsights> & { analyse?: ClientInsights["analysis"] };
  const analysis = raw.analysis ?? raw.analyse ?? { watWerkt: [], watMinder: [], ontwikkelingen: [] };
  const insights: ClientInsights = {
    analysis: {
      watWerkt: Array.isArray(analysis.watWerkt) ? analysis.watWerkt : [],
      watMinder: Array.isArray(analysis.watMinder) ? analysis.watMinder : [],
      ontwikkelingen: Array.isArray(analysis.ontwikkelingen) ? analysis.ontwikkelingen : [],
    },
    verbeterpunten: Array.isArray(raw.verbeterpunten) ? raw.verbeterpunten : [],
  };
  // Niets bruikbaars terug → als fout behandelen i.p.v. een leeg kaartje opslaan.
  if (insights.verbeterpunten.length === 0 && insights.analysis.watWerkt.length === 0 && insights.analysis.watMinder.length === 0) {
    return { ok: false, reason: "error", message: "De AI-analyse leverde geen bruikbare uitkomst op. Probeer het opnieuw." };
  }

  await db.insert(aiOutputs).values({
    clientId: r.client.id,
    tool: "insights",
    title: `Resultatenanalyse (${days} dagen)`,
    inputSummary: `${r.totals.views} weergaven · ${r.totals.posts} video's · ${days} dagen`,
    output: insights as unknown as Record<string, unknown>,
    createdById: viewer?.id ?? null,
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
