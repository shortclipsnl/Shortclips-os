/**
 * Klantinzichten: "Wat werkt bij jouw bedrijf?"
 *
 * Vertaalt het Contentadvies (advice.ts) naar wat de klant in het portaal ziet,
 * in vier vragen: wat werkt goed, wat werkt minder, wat verbeteren wij en wat
 * testen we. Puur rekenwerk: geen database en geen AI-tekst.
 *
 * Uitgangspunten:
 *  - De klant ziet alleen inzichten die het team heeft goedgekeurd.
 *  - Elk inzicht laat zien op hoeveel video's het rust en welke video's dat zijn.
 *  - Drie niveaus voor de klant, strenger dan intern:
 *      bewezen    minstens acht video's met een consequent resultaat;
 *      voorlopig  vier tot zeven video's, of intern bewezen op minder dan acht;
 *      hypothese  minder dan vier video's, of een nieuw voorstel zonder eigen cijfers.
 *  - Teksten voor de klant zijn vaste zinnen met de echte cijfers; alleen het
 *    team kan er een eigen titel of toelichting voor in de plaats zetten.
 */

import type { AdviceDim, AdviceItem, AdviceRef, AdviceSection } from "./advice";
import type { AdviceRecord, AdviceStatus } from "./advice-store";

export type InsightTier = "bewezen" | "voorlopig" | "hypothese";
export const TIER_LABEL: Record<InsightTier, string> = { bewezen: "Bewezen", voorlopig: "Voorlopig", hypothese: "Hypothese" };
export const TIER_NOTE: Record<InsightTier, string> = {
  bewezen: "Minstens acht video's met een consequent resultaat.",
  voorlopig: "Vier tot zeven video's, of nog wisselende resultaten.",
  hypothese: "Minder dan vier video's, of een nieuw idee dat we nog testen.",
};
export const MIN_PROVEN = 8;
export const MIN_PROVISIONAL = 4;

export type ReviewDecision = "tonen" | "verbergen";
export type InsightReview = {
  key: string;
  decision: ReviewDecision;
  clientTitle: string | null;
  clientText: string | null;
  reviewedAt: string | null;
};

export type InsightGroup = "goed" | "minder" | "testen";

export type ClientInsight = {
  key: string;
  group: InsightGroup;
  /** Opening, Type video, Afsluiter, ... */
  category: string;
  title: string;
  text: string;
  tier: InsightTier;
  /** "14 video's, waarvan 10 boven je normale niveau". */
  proofLine: string;
  /** Wat Shortclips ermee doet, afhankelijk van de voortgang. */
  action: string;
  videos: AdviceRef[];
  /** Alleen bij tests: 1 voorstel, 2 ingepland, 3 online, 4 uitkomst. */
  step: 1 | 2 | 3 | 4 | null;
  outcome: "bevestigd" | "niet_bevestigd" | null;
};

export type ClientImprovement = {
  key: string;
  insight: string;
  action: string;
  status: AdviceStatus;
  statusLabel: string;
  result: string;
  videos: AdviceRef[];
  since: string;
};

export type ClientInsights = {
  goed: ClientInsight[];
  minder: ClientInsight[];
  testen: ClientInsight[];
  verbeterd: ClientImprovement[];
  /** Aantal inzichten dat de klant ziet. */
  shown: number;
};

const fx = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;
const CATEGORY: Record<AdviceDim, string> = {
  format: "Type video",
  hook: "Opening",
  cta: "Afsluiter",
  lengte: "Videolengte",
  opbouw: "Opbouw",
  filmstijl: "Manier van filmen",
};
const GROUP: Record<AdviceSection, InsightGroup> = { meer: "goed", blijven: "goed", minder: "minder", testen: "testen" };
const LIMIT: Record<InsightGroup, number> = { goed: 6, minder: 4, testen: 4 };

/** Niveau voor de klant. Strenger dan het interne "bewezen" (dat vier video's vraagt). */
export function insightTier(i: Pick<AdviceItem, "proof" | "n" | "source">): InsightTier {
  if (i.source !== "resultaten") return "hypothese";
  if (i.proof === "bewezen" && i.n >= MIN_PROVEN) return "bewezen";
  if (i.proof === "bewezen" || i.n >= MIN_PROVISIONAL) return "voorlopig";
  return "hypothese";
}

/** Standaardtitel voor de klant: zonder vaktaal. */
export function defaultTitle(i: Pick<AdviceItem, "title" | "dimension" | "label">): string {
  if (i.dimension === "format") return `Video's in het format "${i.label}"`;
  return i.title.replace(/\bhook\b/g, "opening").replace(/\bHook\b/g, "Opening").replace(/\bCTA\b/g, "afsluiter");
}

/** Standaardtoelichting voor de klant: één zin met het echte cijfer. */
export function defaultText(i: Pick<AdviceItem, "section" | "perf" | "n" | "source">): string {
  const group = GROUP[i.section];
  if (group === "testen") {
    return i.source === "resultaten" && i.n
      ? "De eerste video's zijn veelbelovend, maar het zijn er nog te weinig voor een conclusie."
      : "Een nieuw idee dat we bij jou nog niet hebben getest.";
  }
  if (i.perf == null || !i.n) return group === "goed" ? "Dit valt op in je best presterende video's." : "Dit valt op in video's die achterblijven.";
  return group === "goed"
    ? `Video's hiermee halen ${fx(i.perf)} je normale niveau.`
    : `Video's hiermee komen uit op ${fx(i.perf)} je normale niveau.`;
}

export function proofLine(i: Pick<AdviceItem, "n" | "hits">): string {
  if (!i.n) return "Nog geen video's: dit is een nieuw voorstel";
  if (i.n === 1) return "1 video. Te weinig voor een conclusie";
  return `${i.n} video's, waarvan ${i.hits} boven je normale niveau`;
}

function actionOf(section: AdviceSection, status: AdviceStatus | null): string {
  if (status === "ingepland") return "Ingepland voor de volgende scripts en opnames.";
  if (status === "uitgevoerd" || status === "resultaat") return "Toegepast in nieuwe video's. We meten nu het effect.";
  if (section === "blijven") return "Dit blijft een vaste basis in je video's.";
  if (section === "meer") return "We zetten dit vaker in bij de volgende opnames.";
  if (section === "minder") return "We passen dit aan in de volgende scripts en opnames.";
  return "We testen dit in de komende video's en meten of het beter werkt.";
}

const STEP: Record<AdviceStatus, 1 | 2 | 3 | 4> = { nog_toepassen: 1, ingepland: 2, uitgevoerd: 3, resultaat: 3, effectief: 4, niet_effectief: 4, vervallen: 1 };

function toInsight(i: AdviceItem, review: InsightReview, record: AdviceRecord | undefined): ClientInsight {
  const group = GROUP[i.section];
  const status = record?.status ?? null;
  return {
    key: i.key,
    group,
    category: CATEGORY[i.dimension] ?? "Inzicht",
    title: review.clientTitle?.trim() || defaultTitle(i),
    text: review.clientText?.trim() || defaultText(i),
    tier: insightTier(i),
    proofLine: proofLine(i),
    action: actionOf(i.section, status),
    videos: i.evidence,
    step: group === "testen" ? STEP[status ?? "nog_toepassen"] : null,
    outcome: status === "effectief" ? "bevestigd" : status === "niet_effectief" ? "niet_bevestigd" : null,
  };
}

const STATUS_CLIENT: Partial<Record<AdviceStatus, string>> = {
  ingepland: "Ingepland",
  uitgevoerd: "Toegepast",
  resultaat: "Eerste resultaten",
  effectief: "Werkt",
  niet_effectief: "Werkte niet",
};

function resultOf(r: AdviceRecord): string {
  const o = r.outcome;
  if (r.status === "ingepland") return "Staat klaar voor de volgende opnames.";
  if (r.status === "uitgevoerd") return o?.matched ? `Toegepast in ${o.matched} ${o.matched === 1 ? "video" : "video's"}. Het resultaat volgt zodra de cijfers compleet zijn.` : "Toegepast. Het resultaat volgt zodra de cijfers compleet zijn.";
  if (!o || o.median == null) return r.status === "effectief" ? "Dit heeft gewerkt." : r.status === "niet_effectief" ? "Dit leverde geen verbetering op. We kiezen een andere aanpak." : "De eerste cijfers komen binnen.";
  const n = o.videoIds.length;
  const base = `${n} ${n === 1 ? "video" : "video's"} sindsdien: ${fx(o.median)} je normale niveau${o.before != null ? ` (daarvoor ${fx(o.before)})` : ""}.`;
  if (r.status === "effectief") return `${base} Dit heeft gewerkt.`;
  if (r.status === "niet_effectief") return `${base} Dit leverde geen verbetering op. We kiezen een andere aanpak.`;
  return `${base} Nog te vroeg voor een oordeel.`;
}

/**
 * Bouwt de klantweergave uit het actuele advies, de voortgangsregels en de
 * beoordelingen van het team. Niet-goedgekeurde inzichten komen er niet in.
 */
export function buildClientInsights(input: {
  sections: Record<AdviceSection, AdviceItem[]>;
  open: Record<string, AdviceRecord>;
  running: AdviceRecord[];
  learned: AdviceRecord[];
  reviews: InsightReview[];
  /** Zoekt een video op bij een id (voor "toegepast in"). */
  videoRef?: (id: string) => AdviceRef | null;
}): ClientInsights {
  const approved = new Map(input.reviews.filter((r) => r.decision === "tonen").map((r) => [r.key, r]));
  const out: ClientInsights = { goed: [], minder: [], testen: [], verbeterd: [], shown: 0 };

  const items = [...input.sections.meer, ...input.sections.blijven, ...input.sections.minder, ...input.sections.testen];
  for (const i of [...items].sort((a, b) => b.impact - a.impact)) {
    const review = approved.get(i.key);
    if (!review) continue;
    const insight = toInsight(i, review, input.open[i.key]);
    if (out[insight.group].length < LIMIT[insight.group]) out[insight.group].push(insight);
  }
  // Afgeronde tests: de uitkomst blijft zichtbaar bij "Dit testen we".
  for (const r of input.learned) {
    const review = approved.get(r.key);
    if (!review || r.section !== "testen" || out.testen.some((t) => t.key === r.key) || out.testen.length >= LIMIT.testen) continue;
    out.testen.push(toInsight(r.item, review, r));
  }

  const refs = (ids: string[]) => (input.videoRef ? ids.map((id) => input.videoRef!(id)).filter((v): v is AdviceRef => !!v).slice(0, 3) : []);
  const seen = new Set<string>();
  for (const r of [...Object.values(input.open), ...input.running, ...input.learned]) {
    const review = approved.get(r.key);
    if (!review || r.section === "testen" || !STATUS_CLIENT[r.status] || seen.has(r.id)) continue;
    seen.add(r.id);
    out.verbeterd.push({
      key: r.key,
      insight: review.clientTitle?.trim() || defaultTitle(r.item),
      action: r.section === "minder" ? "We gebruiken dit minder en kiezen een andere aanpak." : "We zetten dit bewust vaker in.",
      status: r.status,
      statusLabel: STATUS_CLIENT[r.status]!,
      result: resultOf(r),
      videos: refs(r.outcome?.videoIds ?? []),
      since: r.measureFrom,
    });
  }
  out.verbeterd.sort((a, b) => b.since.localeCompare(a.since));
  out.verbeterd = out.verbeterd.slice(0, 8);
  out.shown = out.goed.length + out.minder.length + out.testen.length;
  return out;
}

/** Voor het team: hoeveel actuele inzichten nog niet beoordeeld zijn. */
export function pendingReviews(sections: Record<AdviceSection, AdviceItem[]>, reviews: InsightReview[]): number {
  const done = new Set(reviews.map((r) => r.key));
  return [...sections.meer, ...sections.blijven, ...sections.minder, ...sections.testen].filter((i) => !done.has(i.key)).length;
}
