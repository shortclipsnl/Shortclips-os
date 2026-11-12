/**
 * Content Opportunity Score.
 *
 * De AI levert per onderdeel een score (0–10) en geeft aan of die op data of op
 * een inschatting rust. De code bepaalt het gewicht, dwingt eerlijkheid af (geen
 * "data" claimen als die data er niet is) en rekent het totaal uit. Zo is de
 * score uitlegbaar en niet afhankelijk van de stemming van het model.
 */

export const OPPORTUNITY_PARTS = [
  { key: "relevantie", label: "Relevantie doelgroep", weight: 20 },
  { key: "eerdereResultaten", label: "Resultaten vergelijkbare video's", weight: 20 },
  { key: "concurrentie", label: "Concurrentie- en marktsignaal", weight: 15 },
  { key: "originaliteit", label: "Originaliteit", weight: 15 },
  { key: "doelaansluiting", label: "Aansluiting op klantdoel", weight: 15 },
  { key: "uitvoerbaarheid", label: "Uitvoerbaar op de opnamedag", weight: 15 },
] as const;

export type OpportunityKey = (typeof OPPORTUNITY_PARTS)[number]["key"];
export type OpportunityPart = { score: number; basis: "data" | "inschatting"; toelichting: string };
export type Opportunity = Record<OpportunityKey, OpportunityPart>;

export type EvidenceContext = {
  /** Zijn er echte postmetingen voor deze klant? */
  hasPostData: boolean;
  /** Is er concreet concurrentie-/marktmateriaal met bron? */
  hasCompetitorSources: boolean;
};

function clamp(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 5;
  return Math.max(0, Math.min(10, v));
}

/** Normaliseert de ruwe AI-output en corrigeert ongegronde "data"-claims. */
export function normalizeOpportunity(raw: unknown, ctx: EvidenceContext, fallbackScore = 5): Opportunity {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as Opportunity;
  for (const part of OPPORTUNITY_PARTS) {
    const p = (o[part.key] && typeof o[part.key] === "object" ? o[part.key] : {}) as Record<string, unknown>;
    let basis: OpportunityPart["basis"] = p.basis === "data" ? "data" : "inschatting";
    // Alleen deze twee onderdelen kúnnen op harde data rusten. De rest is per
    // definitie een inschatting, wat het model ook zegt.
    if (part.key === "eerdereResultaten" && !ctx.hasPostData) basis = "inschatting";
    if (part.key === "concurrentie" && !ctx.hasCompetitorSources) basis = "inschatting";
    if (part.key !== "eerdereResultaten" && part.key !== "concurrentie") basis = "inschatting";
    out[part.key] = {
      score: p.score === undefined ? clamp(fallbackScore) : clamp(p.score),
      basis,
      toelichting: typeof p.toelichting === "string" ? p.toelichting.trim().slice(0, 300) : "",
    };
  }
  // Zonder eigen data mag "eerdere resultaten" het idee niet omhoog trekken.
  if (!ctx.hasPostData) out.eerdereResultaten.score = Math.min(out.eerdereResultaten.score, 5);
  return out;
}

/** Gewogen totaal 0–100. */
export function opportunityTotal(o: Opportunity): number {
  let sum = 0;
  let weights = 0;
  for (const part of OPPORTUNITY_PARTS) {
    sum += o[part.key].score * part.weight;
    weights += part.weight;
  }
  return Math.round((sum / (weights * 10)) * 100);
}

/** Hoeveel procent van het gewicht rust op echte data (voor de UI). */
export function dataShare(o: Opportunity): number {
  let data = 0;
  let total = 0;
  for (const part of OPPORTUNITY_PARTS) {
    total += part.weight;
    if (o[part.key].basis === "data") data += part.weight;
  }
  return Math.round((data / total) * 100);
}

/**
 * Sorteert op score maar houdt variatie: elk volgend idee uit een categorie die
 * al gekozen is, krijgt een kleine straf. Zo blijft de top niet gevuld met vijf
 * varianten van één succesvol format.
 */
export function rankWithVariety<T extends { opportunityScore: number; categorie: string; id: string }>(
  items: T[],
  penalty = 0.88,
): T[] {
  const pool = [...items];
  const out: T[] = [];
  const used = new Map<string, number>();
  while (pool.length) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    pool.forEach((it, i) => {
      const n = used.get(it.categorie) ?? 0;
      const val = it.opportunityScore * Math.pow(penalty, n);
      if (val > bestVal || (val === bestVal && it.id < pool[bestIdx]!.id)) {
        bestVal = val;
        bestIdx = i;
      }
    });
    const [picked] = pool.splice(bestIdx, 1);
    out.push(picked!);
    used.set(picked!.categorie, (used.get(picked!.categorie) ?? 0) + 1);
  }
  return out;
}
