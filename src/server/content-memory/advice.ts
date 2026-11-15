/**
 * Contentadvies: "Wat gaan we nu beter doen?"
 *
 * Vertaalt het Contentgeheugen naar concrete instructies voor het team, in zes
 * onderdelen: meer doen, minder doen, blijven toepassen, nieuw testen,
 * volgende opnamedag en de drie prioriteiten.
 *
 * Puur rekenwerk (geen database, geen AI-tekst). Elke uitspraak rust op de
 * echte resultaten van deze klant en verwijst naar de video's die haar dragen.
 *
 * Extra analyses bovenop het bestaande geheugen:
 *  - Middenstuk: opbouw (AI-label per video uit hook en caption), filmstijl en
 *    lengte, beoordeeld op prestatie én op het uitgekeken deel. Het uitgekeken
 *    deel is gecorrigeerd voor lengte, omdat korte video's altijd verder
 *    worden uitgekeken.
 *  - Call to action per doel: een afsluiting die om reacties vraagt wordt
 *    beoordeeld op reacties per 1.000 weergaven, een deel-CTA op shares, enz.
 *    Klikken en aanvragen tellen alleen mee als ze echt gemeten zijn.
 *  - Verzadiging: iets dat in de recente video's veel wordt gebruikt en minder
 *    gaat scoren, wordt als "te vaak herhaald" aangemerkt.
 *
 * Bescherming tegen toeval: oordelen rusten op de mediaan van meerdere video's
 * en het aandeel boven normaal. "Bewezen" vraagt minstens vier video's met een
 * consequent beeld; al het andere heet hypothese en hoort bij "Nieuw testen".
 */

import { captionKey, evidenceOf, lengthBucket, median, MIN_VIDEOS, type ContentMemory, type Evidence, type MemoryVideo } from "./analyze";
import { HOOK_PLAY, statusOf, type PlayStatus } from "./playbook";
import { CTA_ADVICE, CTA_PLAY, HOOK_ADVICE, LENGTH_ADVICE } from "./dna";

export type AdviceDim = "format" | "hook" | "cta" | "lengte" | "opbouw" | "filmstijl";
export type AdvicePhase = "format" | "hook" | "midden" | "cta";
export type AdviceSection = "meer" | "minder" | "blijven" | "testen";
export type AdviceProof = "bewezen" | "hypothese";
export type AdviceSource = "resultaten" | "voorstel" | "andere_klanten";

export type AdviceRef = {
  id: string;
  title: string;
  platform: string;
  url: string | null;
  perf: number;
  views: number;
  thumbnail: string | null;
  publishedOn: string | null;
};

export type AdviceItem = {
  /** Stabiele sleutel: zelfde advies = zelfde sleutel, zodat de voortgang gekoppeld blijft. */
  key: string;
  section: AdviceSection;
  phase: AdvicePhase;
  dimension: AdviceDim;
  label: string;
  title: string;
  /** Inzicht: wat de cijfers laten zien. */
  insight: string;
  /** Advies: wat het team gaat doen. */
  advice: string;
  /** Toepassing: hoe precies. */
  application: string;
  /** Meten: waaraan we zien of het werkt. */
  measure: string;
  proof: AdviceProof;
  proofNote: string;
  source: AdviceSource;
  n: number;
  hits: number;
  perf: number | null;
  /** Bewijs: de video's waarop dit advies rust. */
  evidence: AdviceRef[];
  /** Letterlijk voorbeeld (hook of CTA), als inspiratie. */
  quote: string | null;
  impact: number;
  /** Waaraan het systeem herkent dat het advies is toegepast; null = alleen handmatig. */
  target: { dimension: AdviceDim; label: string } | null;
};

export type CtaGoal = "interactie" | "delen" | "opslaan" | "volgen" | "verkeer" | "aanvragen";
export type CtaGoalRow = { label: string; title: string; n: number; score: number | null; perf: number; best: boolean };
export type CtaGoalView = {
  goal: CtaGoal;
  title: string;
  metric: string;
  measurable: boolean;
  note: string;
  rows: CtaGoalRow[];
};

export type PhaseSummary = {
  phase: Exclude<AdvicePhase, "format">;
  title: string;
  doen: AdviceItem | null;
  laten: AdviceItem | null;
  testen: AdviceItem | null;
  /** Getoond als er nog niets te concluderen valt. */
  note: string | null;
};

export type ShootLine = { kind: "basis" | "doen" | "laten" | "testen"; phase: AdvicePhase; text: string; proof: AdviceProof; key: string };

export type CrossPattern = { dimension: AdviceDim; label: string; clientIds: string[]; medianPerf: number };

export type ContentAdvice = {
  sufficient: boolean;
  videoCount: number;
  sections: Record<AdviceSection, AdviceItem[]>;
  priorities: AdviceItem[];
  nextShoot: ShootLine[];
  phases: PhaseSummary[];
  ctaGoals: CtaGoalView[];
  coverage: { structure: number; filmStyle: number; retention: number; total: number };
  /** Wat het systeem (nog) niet kan zien, eerlijk benoemd. */
  gaps: string[];
};

export type AdviceContext = {
  clientId?: string;
  /** AI-label per video: opbouw van het middenstuk. */
  structures?: Record<string, string>;
  /** AI-label per video: filmstijl (uit de strategie-analyse). */
  styles?: Record<string, string>;
  /** Nieuwe formatvoorstellen uit de strategie-analyse (nog niet getest). */
  formatIdeas?: Array<{ base: string; name: string; description: string; hook: string }>;
  /** Contentideeën uit de format-analyse (nog niet getest). */
  ideas?: Array<{ title: string; format: string; hook: string; reason: string }>;
  /** Patronen die bij andere klanten bewezen zijn. */
  cross?: CrossPattern[];
};

export const STRUCTURES = ["Rondleiding", "Demonstratie", "Vergelijking", "Uitleg of tips", "Verhaal of case", "Vraag en antwoord", "Opsomming", "Sfeerimpressie"] as const;

/* ------------------------------------------------------------------ *
 * Taal
 * ------------------------------------------------------------------ */

const fx = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;
const lc = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const r2 = (x: number) => Math.round(x * 100) / 100;

const STRUCTURE_APPLY: Record<string, string> = {
  Rondleiding: "Neem de kijker in een vaste route mee en laat elke paar seconden een nieuwe ruimte of een nieuw onderdeel zien.",
  Demonstratie: "Laat het product of de dienst in gebruik zien in plaats van erover te vertellen.",
  Vergelijking: "Zet twee opties naast elkaar en laat het verschil in beeld zien.",
  "Uitleg of tips": "Breng één onderwerp in maximaal drie korte punten, elk met een eigen beeld.",
  "Verhaal of case": "Vertel één concreet voorbeeld van begin tot eind: situatie, wat er gebeurde, resultaat.",
  "Vraag en antwoord": "Laat een vraag stellen en geef direct een kort antwoord.",
  Opsomming: "Kondig het aantal punten aan en tel ze zichtbaar af.",
  Sfeerimpressie: "Laat beelden het werk doen, met weinig tekst en een duidelijk tempo.",
};

export function adviceTitle(dimension: AdviceDim, label: string): string {
  if (dimension === "format") return `Format "${label}"`;
  if (dimension === "hook") return HOOK_PLAY[label] ?? (label === "Stelling" ? "Openen met een gewone stelling" : label);
  if (dimension === "cta") return label === "Geen duidelijke CTA" ? "Video's zonder duidelijke afsluiting" : CTA_PLAY[label] ?? label;
  if (dimension === "lengte") return `Video's van ${lc(label)}`;
  if (dimension === "opbouw") return `Middenstuk als ${lc(label)}`;
  return `Filmstijl: ${lc(label)}`;
}

const PHASE: Record<AdviceDim, AdvicePhase> = { format: "format", hook: "hook", cta: "cta", lengte: "midden", opbouw: "midden", filmstijl: "midden" };

function applicationOf(dimension: AdviceDim, label: string, quote: string | null): string {
  const example = quote ? ` Voorbeeld dat werkte (niet letterlijk kopiëren): "${quote}"` : "";
  if (dimension === "hook") return `Open met ${HOOK_ADVICE[label] ?? lc(adviceTitle(dimension, label))}.${example}`;
  if (dimension === "cta") return `Sluit af met ${CTA_ADVICE[label] ?? lc(adviceTitle(dimension, label))}.${example}`;
  if (dimension === "format") return "Plan dit format in op de volgende opnamedag en schrijf er minstens twee scripts voor.";
  if (dimension === "lengte") return `Schrijf de scripts zo dat de video ${LENGTH_ADVICE[label] ?? lc(label)} duurt.`;
  if (dimension === "opbouw") return STRUCTURE_APPLY[label] ?? `Bouw het middenstuk op als ${lc(label)}.`;
  return `Neem de video op in de stijl ${lc(label)} en geef dit door in de editorbriefing.`;
}

function measureOf(dimension: AdviceDim, goalMetric?: string | null): string {
  if (dimension === "cta" && goalMetric) return `Vergelijk ${goalMetric} per 1.000 weergaven met video's met een andere afsluiting op hetzelfde platform.`;
  if (dimension === "hook") return "Vergelijk de prestatie t.o.v. normaal en het uitgekeken deel met video's met een andere opening op hetzelfde platform.";
  if (dimension === "opbouw" || dimension === "filmstijl" || dimension === "lengte") return "Vergelijk het uitgekeken deel en de prestatie t.o.v. normaal met de andere video's op hetzelfde platform.";
  return "Vergelijk de prestatie t.o.v. normaal (weergaven en interactie) met de andere video's op hetzelfde platform.";
}

/* ------------------------------------------------------------------ *
 * Groepen
 * ------------------------------------------------------------------ */

type Group = {
  dimension: AdviceDim;
  label: string;
  vs: MemoryVideo[];
  n: number;
  medianPerf: number;
  hitRate: number;
  evidence: Evidence;
  trend: "sterker" | "zwakker" | "stabiel" | null;
  /** Uitgekeken deel t.o.v. video's van dezelfde lengte (1 = normaal); null = te weinig kijkdata. */
  hold: number | null;
  holdN: number;
  holdHit: number;
  /** Aandeel in de laatste unieke video's; null = te weinig video's. */
  recentShare: number | null;
  recentCount: number;
  recentTotal: number;
  status: PlayStatus;
};

const uniq = (vs: MemoryVideo[]) => {
  const seen = new Set<string>();
  return vs.filter((v) => {
    const k = captionKey(v.caption) || v.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const ref = (v: MemoryVideo): AdviceRef => ({ id: v.id, title: v.title, platform: v.platform, url: v.externalUrl, perf: v.perf, views: v.views, thumbnail: v.thumbnail, publishedOn: v.publishedOn });

/** Uitgekeken deel per video t.o.v. het normale niveau bij dezelfde lengte. */
export function holdScores(all: MemoryVideo[]): Map<string, number> {
  const withRet = all.filter((v) => v.retention != null && v.retention > 0);
  const out = new Map<string, number>();
  if (withRet.length < 4) return out;
  const overall = median(withRet.map((v) => v.retention!)) ?? 0;
  const byBucket = new Map<string, number[]>();
  for (const v of withRet) {
    const b = lengthBucket(v.durationSeconds) ?? "-";
    byBucket.set(b, [...(byBucket.get(b) ?? []), v.retention!]);
  }
  for (const v of withRet) {
    const xs = byBucket.get(lengthBucket(v.durationSeconds) ?? "-") ?? [];
    const base = xs.length >= 3 ? median(xs)! : overall;
    if (base > 0) out.set(v.id, v.retention! / base);
  }
  return out;
}

function buildGroups(m: ContentMemory, ctx: AdviceContext): Group[] {
  const all = m.all;
  const dates = all.map((v) => v.publishedOn).filter((d): d is string => !!d).sort();
  const midDate = dates.length ? dates[Math.floor(dates.length / 2)] : null;
  const hold = holdScores(all);
  const recent = uniq([...all].sort((a, b) => (b.publishedOn ?? "").localeCompare(a.publishedOn ?? ""))).slice(0, 10);

  const make = (dimension: AdviceDim, keyOf: (v: MemoryVideo) => string[]): Group[] => {
    const map = new Map<string, MemoryVideo[]>();
    for (const v of all) for (const k of keyOf(v)) map.set(k, [...(map.get(k) ?? []), v]);
    return [...map.entries()].map(([label, vs]) => {
      const medianPerf = r2(median(vs.map((v) => v.perf)) ?? 1);
      const hitRate = vs.filter((v) => v.perf >= 1).length / vs.length;
      let trend: Group["trend"] = null;
      let halvesAgree: boolean | null = null;
      if (midDate) {
        const a = vs.filter((v) => v.publishedOn && v.publishedOn < midDate);
        const b = vs.filter((v) => v.publishedOn && v.publishedOn >= midDate);
        if (a.length >= 2 && b.length >= 2) {
          const ma = median(a.map((v) => v.perf)) ?? 1;
          const mb = median(b.map((v) => v.perf)) ?? 1;
          trend = mb >= ma * 1.25 ? "sterker" : mb <= ma * 0.8 ? "zwakker" : "stabiel";
          halvesAgree = (ma >= 1) === (mb >= 1);
        }
      }
      const evidence = evidenceOf(vs.length, hitRate, halvesAgree);
      const hs = vs.map((v) => hold.get(v.id)).filter((x): x is number => x != null);
      const recentCount = recent.filter((v) => keyOf(v).includes(label)).length;
      return {
        dimension, label, vs, n: vs.length, medianPerf, hitRate: r2(hitRate), evidence, trend,
        hold: hs.length >= 4 ? r2(median(hs)!) : null,
        holdN: hs.length,
        holdHit: hs.length ? hs.filter((x) => x >= 1).length / hs.length : 0,
        recentShare: recent.length >= 6 ? recentCount / recent.length : null,
        recentCount,
        recentTotal: recent.length,
        status: statusOf({ n: vs.length, medianPerf, evidence }),
      };
    });
  };

  return [
    ...make("format", (v) => (v.format ? [v.format] : [])),
    ...make("hook", (v) => v.hookTypes),
    ...make("cta", (v) => [v.cta]),
    ...make("lengte", (v) => { const b = lengthBucket(v.durationSeconds); return b ? [b] : []; }),
    ...make("opbouw", (v) => { const s = ctx.structures?.[v.id]; return s && s !== "Onbekend" ? [s] : []; }),
    ...make("filmstijl", (v) => { const s = ctx.styles?.[v.id]; return s && s !== "Onbekend" ? [s] : []; }),
  ];
}

/* ------------------------------------------------------------------ *
 * Call to action per doel
 * ------------------------------------------------------------------ */

const GOAL_META: Record<CtaGoal, { title: string; metric: string }> = {
  interactie: { title: "Reacties, vragen en meningen", metric: "reacties" },
  delen: { title: "Delen stimuleren", metric: "shares" },
  opslaan: { title: "Opslaan stimuleren", metric: "keer opgeslagen" },
  volgen: { title: "Volgen stimuleren", metric: "nieuwe volgers" },
  verkeer: { title: "Websitebezoek", metric: "linkklikken" },
  aanvragen: { title: "Aanvragen en contact", metric: "aanvragen" },
};

export function ctaGoalOf(v: Pick<MemoryVideo, "cta" | "ctaText">): CtaGoal | null {
  switch (v.cta) {
    case "Poll of keuze":
    case "Raden":
    case "Reactie vragen": return "interactie";
    case "Opslaan of delen": return /\bsla\b|opslaan|bewaar/i.test(v.ctaText ?? "") ? "opslaan" : "delen";
    case "Volgen": return "volgen";
    case "Website of link": return "verkeer";
    case "Afspraak of bezichtiging":
    case "Contact opnemen": return "aanvragen";
    default: return null;
  }
}

const goalValue = (goal: CtaGoal, v: MemoryVideo): number | null => {
  if (v.views <= 0) return null;
  const per = (x: number | null) => (x == null ? null : (x / v.views) * 1000);
  if (goal === "interactie") return per(v.comments);
  if (goal === "delen") return per(v.shares);
  if (goal === "opslaan") return per(v.saves);
  if (goal === "volgen") return per(v.followerDelta);
  if (goal === "verkeer") return per(v.linkClicks);
  return per(v.conversions);
};

function ctaGoals(m: ContentMemory): CtaGoalView[] {
  const out: CtaGoalView[] = [];
  for (const goal of Object.keys(GOAL_META) as CtaGoal[]) {
    const vs = m.all.filter((v) => ctaGoalOf(v) === goal);
    if (!vs.length) continue;
    // Normaal niveau van dit doel per platform, over alle video's van de klant.
    const base = new Map<string, number>();
    for (const p of new Set(m.all.map((v) => v.platform))) {
      const xs = m.all.filter((v) => v.platform === p).map((v) => goalValue(goal, v)).filter((x): x is number => x != null);
      const med = median(xs);
      const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      const b = med && med > 0 ? med : mean;
      if (xs.length >= 4 && b > 0) base.set(p, b);
    }
    const measurable = base.size > 0 && vs.some((v) => (goalValue(goal, v) ?? 0) > 0 || base.has(v.platform));
    const labels = [...new Set(vs.map((v) => v.cta))];
    const rows: CtaGoalRow[] = labels.map((label) => {
      const gv = vs.filter((v) => v.cta === label);
      const scores = gv.map((v) => { const b = base.get(v.platform); const x = goalValue(goal, v); return b && x != null ? x / b : null; }).filter((x): x is number => x != null);
      return { label, title: adviceTitle("cta", label), n: gv.length, score: measurable && scores.length >= 2 ? r2(median(scores)!) : null, perf: r2(median(gv.map((v) => v.perf)) ?? 1), best: false };
    }).sort((a, b) => (b.score ?? b.perf) - (a.score ?? a.perf));
    if (rows.length && (rows[0].score ?? 0) >= 1.2 && rows[0].n >= 4) rows[0].best = true;
    const meta = GOAL_META[goal];
    const note = measurable
      ? `Beoordeeld op ${meta.metric} per 1.000 weergaven, t.o.v. het normale niveau van deze klant.`
      : goal === "verkeer" || goal === "aanvragen"
        ? `Niet meetbaar: er is geen ${goal === "verkeer" ? "klikdata" : "conversiedata"} gekoppeld. Beoordeeld op bereik en interactie; of deze afsluiting ${goal === "verkeer" ? "bezoekers" : "aanvragen"} oplevert is onbekend.`
        : `Nog te weinig ${meta.metric} gemeten om dit doel apart te beoordelen.`;
    out.push({ goal, title: meta.title, metric: meta.metric, measurable, note, rows });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Advies opbouwen
 * ------------------------------------------------------------------ */

const SKIP = (g: Group) => (g.dimension === "hook" && g.label === "Stelling") || (g.dimension === "cta" && g.label === "Geen duidelijke CTA");
const solid = (g: Group) => g.evidence === "aannemelijk" || g.evidence === "sterk";
const weight = (n: number) => Math.min(n, 12) / 12;

function quoteOf(g: Group): string | null {
  const best = [...g.vs].sort((a, b) => b.perf - a.perf);
  if (g.dimension === "hook") return best.find((v) => v.hook.length >= 12)?.hook ?? null;
  if (g.dimension === "cta") return best.find((v) => v.ctaText)?.ctaText ?? null;
  return null;
}

function holdLine(g: Group): string {
  if (g.hold == null || g.holdN < 4) return "";
  if (g.hold >= 1.15 && g.holdHit >= 0.6) return ` Kijkers kijken ${Math.round((g.hold - 1) * 100)}% verder dan normaal bij deze lengte (${g.holdN} video's met kijkdata).`;
  if (g.hold <= 0.85 && g.holdHit <= 0.4) return ` Kijkers haken ${Math.round((1 - g.hold) * 100)}% eerder af dan normaal bij deze lengte (${g.holdN} video's met kijkdata).`;
  return "";
}

function item(section: AdviceSection, g: Group, parts: { insight: string; advice: string; proof: AdviceProof; impact: number; goalMetric?: string | null; worst?: boolean }): AdviceItem {
  const quote = section === "minder" ? null : quoteOf(g);
  const sorted = uniq([...g.vs].sort((a, b) => (parts.worst ? a.perf - b.perf : b.perf - a.perf)));
  const hits = Math.round(g.hitRate * g.n);
  return {
    key: `${section}:${g.dimension}:${g.label}`,
    section,
    phase: PHASE[g.dimension],
    dimension: g.dimension,
    label: g.label,
    title: adviceTitle(g.dimension, g.label),
    insight: parts.insight,
    advice: parts.advice,
    application: section === "minder" ? "" : applicationOf(g.dimension, g.label, quote),
    measure: measureOf(g.dimension, parts.goalMetric),
    proof: parts.proof,
    proofNote: parts.proof === "bewezen" ? `Bewezen: ${hits} van ${g.n} video's boven normaal` : `Hypothese: ${g.n} ${g.n === 1 ? "video" : "video's"}, nog te weinig of te wisselend`,
    source: "resultaten",
    n: g.n,
    hits,
    perf: g.medianPerf,
    evidence: sorted.slice(0, 3).map(ref),
    quote,
    impact: r2(parts.impact),
    target: { dimension: g.dimension, label: g.label },
  };
}

const AMOUNT: Record<AdviceDim, string> = {
  format: "de volgende opnamedag",
  hook: "de volgende drie geschikte video's",
  cta: "de volgende drie geschikte video's",
  lengte: "de volgende opnamedag",
  opbouw: "de volgende drie geschikte video's",
  filmstijl: "de volgende opnamedag",
};

function alternative(groups: Group[], g: Group): Group | null {
  return groups
    .filter((x) => x.dimension === g.dimension && x.label !== g.label && !SKIP(x) && x.status === "bewezen")
    .sort((a, b) => b.medianPerf - a.medianPerf)[0] ?? null;
}

export function buildAdvice(m: ContentMemory, ctx: AdviceContext = {}): ContentAdvice {
  const groups = m.videoCount ? buildGroups(m, ctx) : [];
  const sections: Record<AdviceSection, AdviceItem[]> = { meer: [], minder: [], blijven: [], testen: [] };
  const goals = m.videoCount ? ctaGoals(m) : [];
  const count = (g: Group) => `${Math.round(g.hitRate * g.n)} van ${g.n} video's scoorden boven normaal, gemiddeld ${fx(g.medianPerf)}.`;

  if (m.sufficient) {
    for (const g of groups) {
      const overused = g.recentShare != null && g.recentShare >= 0.6 && g.n >= 5 && (g.trend === "zwakker" || g.medianPerf < 0.95);
      // Bewezen sterk.
      if (g.status === "bewezen" && !SKIP(g)) {
        if (overused && g.trend === "zwakker") {
          sections.minder.push(item("minder", g, {
            insight: `Gebruikt in ${g.recentCount} van de laatste ${g.recentTotal} video's. Het werkte goed (${fx(g.medianPerf)} normaal), maar de recente video's scoren duidelijk lager dan de eerdere.`,
            advice: `Wissel dit af: gebruik het bij ${AMOUNT[g.dimension]} in hooguit de helft van de video's.`,
            proof: "hypothese",
            impact: 0.4 * weight(g.n),
          }));
          continue;
        }
        const routine = g.recentShare != null && g.recentShare >= 0.5;
        sections[routine ? "blijven" : "meer"].push(item(routine ? "blijven" : "meer", g, {
          insight: `${count(g)}${holdLine(g)}${routine ? "" : g.recentShare != null ? ` Toch zat het maar in ${g.recentCount} van de laatste ${g.recentTotal} video's.` : ""}`,
          advice: routine ? "Houd dit aan als vaste basis." : `Gebruik dit bij ${AMOUNT[g.dimension]}.`,
          proof: "bewezen",
          impact: (g.medianPerf - 1) * weight(g.n) * (routine ? 0.6 : 1),
        }));
        continue;
      }
      // Aantoonbaar zwak.
      if (g.medianPerf <= 0.8 && g.n >= 3 && g.evidence !== "gemengd") {
        const alt = alternative(groups, g);
        const instead = alt ? ` Kies liever: ${lc(adviceTitle(alt.dimension, alt.label))} (${fx(alt.medianPerf)} normaal).` : "";
        sections.minder.push(item("minder", g, {
          insight: `${g.n} video's scoorden gemiddeld ${fx(g.medianPerf)} normaal; ${Math.round(g.hitRate * g.n)} daarvan boven normaal.${holdLine(g)}`,
          advice: g.dimension === "cta" && g.label === "Geen duidelijke CTA"
            ? `Geef elke video een duidelijke afsluiting.${instead}`
            : `Gebruik dit bij de volgende opnames niet, of bewust anders.${instead}`,
          proof: solid(g) ? "bewezen" : "hypothese",
          impact: (1 - g.medianPerf) * weight(g.n) * (solid(g) ? 1 : 0.6),
          worst: true,
        }));
        continue;
      }
      // Te vaak herhaald zonder dat het (nog) werkt.
      if (overused && !SKIP(g)) {
        sections.minder.push(item("minder", g, {
          insight: `Gebruikt in ${g.recentCount} van de laatste ${g.recentTotal} video's, terwijl het gemiddeld ${fx(g.medianPerf)} normaal scoort${g.trend === "zwakker" ? " en de recente video's lager scoren dan de eerdere" : ""}.`,
          advice: "Wissel af met een andere aanpak bij de volgende opnames.",
          proof: "hypothese",
          impact: 0.3 * weight(g.n),
          worst: true,
        }));
        continue;
      }
      // Houdt kijkers aantoonbaar langer vast, ook als de totale prestatie normaal is.
      if (!SKIP(g) && g.dimension !== "format" && g.hold != null && g.hold >= 1.15 && g.holdHit >= 0.65 && g.holdN >= 4 && g.medianPerf >= 0.95) {
        sections.meer.push(item("meer", g, {
          insight: `Kijkers kijken ${Math.round((g.hold - 1) * 100)}% verder dan normaal bij deze lengte (${g.holdN} video's met kijkdata). De totale prestatie is ${fx(g.medianPerf)} normaal.`,
          advice: `Gebruik dit bij ${AMOUNT[g.dimension]} om kijkers langer vast te houden.`,
          proof: g.holdN >= 6 ? "bewezen" : "hypothese",
          impact: (g.hold - 1) * weight(g.holdN) * 0.8,
        }));
        continue;
      }
      // Kijkers haken eerder af.
      if (!SKIP(g) && g.dimension !== "format" && g.hold != null && g.hold <= 0.85 && g.holdHit <= 0.35 && g.holdN >= 4) {
        sections.minder.push(item("minder", g, {
          insight: `Kijkers haken ${Math.round((1 - g.hold) * 100)}% eerder af dan normaal bij deze lengte (${g.holdN} video's met kijkdata).`,
          advice: g.dimension === "hook" ? "Test een andere opening bij de volgende opnames: na deze opening haken kijkers eerder af." : g.dimension === "cta" ? "Kondig de afsluiting korter aan of test een andere afsluiting." : "Maak dit onderdeel korter of kies een andere aanpak bij de volgende opnames.",
          proof: g.holdN >= 6 ? "bewezen" : "hypothese",
          impact: (1 - g.hold) * weight(g.holdN) * 0.8,
          worst: true,
        }));
        continue;
      }
    }

    // CTA die op het eigen doel aantoonbaar beter scoort.
    for (const gv of goals) {
      const best = gv.rows.find((r) => r.best);
      if (!best || !gv.measurable) continue;
      const g = groups.find((x) => x.dimension === "cta" && x.label === best.label);
      if (!g) continue;
      const line = ` Levert ${fx(best.score!)} zoveel ${gv.metric} per 1.000 weergaven als normaal.`;
      const existing = [...sections.meer, ...sections.blijven].find((i) => i.dimension === "cta" && i.label === best.label);
      if (existing) {
        existing.insight += line;
        existing.measure = measureOf("cta", gv.metric);
      } else if (!sections.minder.some((i) => i.dimension === "cta" && i.label === best.label)) {
        sections.meer.push(item("meer", g, {
          insight: `${best.n} video's met deze afsluiting.${line} De totale prestatie is ${fx(g.medianPerf)} normaal.`,
          advice: `Gebruik deze afsluiting bij video's die ${gv.metric} moeten opleveren.`,
          proof: best.n >= 6 ? "bewezen" : "hypothese",
          impact: (best.score! - 1) * weight(best.n) * 0.7,
          goalMetric: gv.metric,
        }));
      }
    }
  }

  // Elke beoordeelde afsluiting krijgt ook het cijfer op het eigen doel erbij.
  for (const i of [...sections.meer, ...sections.blijven, ...sections.minder].filter((x) => x.dimension === "cta")) {
    const gv = goals.find((g) => g.measurable && g.rows.some((r) => r.label === i.label && r.score != null));
    const row = gv?.rows.find((r) => r.label === i.label);
    if (!gv || !row || row.score == null || i.insight.includes("per 1.000 weergaven")) continue;
    i.insight += ` Op het eigen doel: ${fx(row.score)} zoveel ${gv.metric} per 1.000 weergaven als normaal${row.score < 0.9 && i.section !== "minder" ? ", dus het levert vooral bereik op en niet meer " + gv.metric : ""}.`;
  }

  /* ---- Nieuw testen: alles wat (nog) geen bewijs heeft ---- */
  const tested = new Set([...sections.meer, ...sections.blijven, ...sections.minder].map((i) => `${i.dimension}:${i.label}`));
  const early = groups
    .filter((g) => !SKIP(g) && !tested.has(`${g.dimension}:${g.label}`) && g.n >= 2 && g.medianPerf >= 1.2 && (g.status !== "bewezen" || !m.sufficient))
    .sort((a, b) => b.medianPerf - a.medianPerf)
    .slice(0, m.sufficient ? 2 : 3);
  for (const g of early) {
    sections.testen.push(item("testen", g, {
      insight: `Scoorde bij ${g.n} video's gemiddeld ${fx(g.medianPerf)} normaal. Dat is te weinig of te wisselend om van een patroon te spreken.`,
      advice: "Test dit bewust bij twee video's van de volgende opnamedag.",
      proof: "hypothese",
      impact: 0.2 + 0.35 * (g.medianPerf - 1) * weight(g.n),
    }));
  }

  // Een CTA-doel dat nog nooit is ingezet.
  if (m.videoCount >= 4) {
    const used = new Set(m.all.map((v) => ctaGoalOf(v)).filter(Boolean));
    const missing = (["interactie", "opslaan", "delen"] as CtaGoal[]).find((g) => !used.has(g));
    if (missing) {
      const label = missing === "interactie" ? "Reactie vragen" : "Opslaan of delen";
      const how = missing === "interactie" ? "een vraag waarop de kijker in de reacties kan antwoorden" : missing === "opslaan" ? "een reden om de video op te slaan voor later" : "een reden om de video door te sturen";
      sections.testen.push({
        key: `testen:cta-doel:${missing}`,
        section: "testen", phase: "cta", dimension: "cta", label,
        title: `Afsluiting gericht op ${GOAL_META[missing].title.toLowerCase()}`,
        insight: `Bij ${m.videoCount} geanalyseerde video's is nog geen enkele afsluiting gericht op ${GOAL_META[missing].title.toLowerCase()}. Of dit bij deze klant werkt is dus onbekend.`,
        advice: "Test dit bij twee video's van de volgende opnamedag.",
        application: `Sluit af met ${how}.`,
        measure: measureOf("cta", GOAL_META[missing].metric),
        proof: "hypothese", proofNote: "Experiment: nog niet eerder gedaan bij deze klant", source: "voorstel",
        n: 0, hits: 0, perf: null, evidence: [], quote: null, impact: 0.08,
        target: missing === "interactie" ? { dimension: "cta", label } : null,
      });
    }
  }

  // Bewezen bij andere klanten, hier nog niet geprobeerd.
  for (const p of (ctx.cross ?? []).filter((p) => p.clientIds.filter((id) => id !== ctx.clientId).length >= 2).sort((a, b) => b.medianPerf - a.medianPerf)) {
    if (sections.testen.filter((i) => i.source === "andere_klanten").length >= 2) break;
    const own = groups.find((g) => g.dimension === p.dimension && g.label === p.label);
    if ((own?.n ?? 0) >= 2 || (p.dimension === "hook" && p.label === "Stelling")) continue;
    const others = p.clientIds.filter((id) => id !== ctx.clientId).length;
    sections.testen.push({
      key: `testen:${p.dimension}:${p.label}`,
      section: "testen", phase: PHASE[p.dimension], dimension: p.dimension, label: p.label,
      title: adviceTitle(p.dimension, p.label),
      insight: `Bewezen bij ${others} andere Shortclips-klanten (gemiddeld ${fx(p.medianPerf)} normaal), bij deze klant ${own?.n ? "pas één keer" : "nog niet"} gebruikt. Of het hier ook werkt is niet bekend.`,
      advice: "Test dit bij twee video's van de volgende opnamedag.",
      application: applicationOf(p.dimension, p.label, null),
      measure: measureOf(p.dimension),
      proof: "hypothese", proofNote: "Experiment: werkt bij andere klanten, hier nog niet getest", source: "andere_klanten",
      n: own?.n ?? 0, hits: 0, perf: null, evidence: [], quote: null, impact: 0.15,
      target: { dimension: p.dimension, label: p.label },
    });
  }

  // Nieuwe formatvoorstellen (AI), altijd als experiment.
  const proposals = (ctx.formatIdeas ?? []).slice(0, 2).map((f) => ({ name: f.name, text: f.description, hook: f.hook, base: `Variatie op het format "${f.base}".` }));
  if (!proposals.length) for (const i of (ctx.ideas ?? []).slice(0, 2)) proposals.push({ name: i.title, text: i.reason, hook: i.hook, base: i.format ? `Bouwt voort op het format "${i.format}".` : "" });
  for (const p of proposals) {
    if (!p.name) continue;
    sections.testen.push({
      key: `testen:idee:${p.name.toLowerCase().slice(0, 60)}`,
      section: "testen", phase: "format", dimension: "format", label: p.name,
      title: p.name,
      insight: `${p.base} ${p.text}`.trim() + " Nieuw voorstel: nog niet getest, dus geen bewijs.",
      advice: "Neem één video in deze vorm op tijdens de volgende opnamedag.",
      application: p.hook ? `Hook om mee te testen: "${p.hook}"` : "Werk het idee uit in één script.",
      measure: measureOf("format"),
      proof: "hypothese", proofNote: "Experiment: nieuw idee", source: "voorstel",
      n: 0, hits: 0, perf: null, evidence: [], quote: null, impact: 0.1,
      target: null,
    });
  }

  for (const k of Object.keys(sections) as AdviceSection[]) sections[k].sort((a, b) => b.impact - a.impact);
  sections.meer = sections.meer.slice(0, 6);
  sections.minder = sections.minder.slice(0, 5);
  sections.blijven = sections.blijven.slice(0, 5);
  sections.testen = sections.testen.slice(0, 5);

  /* ---- Prioriteiten: grootste verschil, verspreid over de fases ---- */
  const pool = [...sections.meer, ...sections.minder].sort((a, b) => b.impact - a.impact);
  const priorities: AdviceItem[] = [];
  for (const i of pool) if (priorities.length < 3 && !priorities.some((p) => p.phase === i.phase)) priorities.push(i);
  for (const i of [...pool, ...sections.testen]) if (priorities.length < 3 && !priorities.includes(i)) priorities.push(i);

  /* ---- Per fase: doen, laten, testen ---- */
  const coverage = {
    structure: m.all.filter((v) => ctx.structures?.[v.id] && ctx.structures[v.id] !== "Onbekend").length,
    filmStyle: m.all.filter((v) => ctx.styles?.[v.id]).length,
    retention: m.all.filter((v) => v.retention != null).length,
    total: m.videoCount,
  };
  const first = (xs: AdviceItem[], phase: AdvicePhase) => xs.find((i) => i.phase === phase) ?? null;
  const NOTE: Record<PhaseSummary["phase"], string> = {
    hook: "Nog geen opening die consequent beter of slechter scoort.",
    midden: `Nog geen betrouwbaar patroon in het middenstuk. Opbouw herkend bij ${coverage.structure} van ${coverage.total} video's, kijkdata bij ${coverage.retention}.`,
    cta: "Nog geen afsluiting die consequent beter of slechter scoort.",
  };
  const phases: PhaseSummary[] = (["hook", "midden", "cta"] as const).map((phase) => {
    const doen = first([...sections.meer, ...sections.blijven].sort((a, b) => b.impact - a.impact), phase);
    const laten = first(sections.minder, phase);
    const testen = first(sections.testen, phase);
    return { phase, title: { hook: "Hook", midden: "Middenstuk", cta: "Call to action" }[phase], doen, laten, testen, note: doen || laten || testen ? null : m.sufficient ? NOTE[phase] : `Nog te weinig video's (${m.videoCount} van minimaal ${MIN_VIDEOS}).` };
  });

  /* ---- Volgende opnamedag ---- */
  const nextShoot: ShootLine[] = [];
  const add = (kind: ShootLine["kind"], i: AdviceItem | null | undefined) => {
    if (!i || nextShoot.some((l) => l.key === i.key) || nextShoot.length >= 6) return;
    const text = kind === "laten" ? `${i.title}: ${lc(i.advice)}` : `${i.title}${/[.?!]$/.test(i.title) ? "" : "."} ${i.application || i.advice}`.replace(/ Voorbeeld dat werkte.*$/, "");
    nextShoot.push({ kind, phase: i.phase, text, proof: i.proof, key: i.key });
  };
  add("basis", sections.blijven[0]);
  for (const phase of ["format", "hook", "midden", "cta"] as AdvicePhase[]) add("doen", first(sections.meer, phase));
  add("laten", sections.minder[0]);
  add("testen", sections.testen[0]);
  add("testen", sections.testen[1]);

  /* ---- Wat we niet kunnen zien ---- */
  const gaps: string[] = [];
  gaps.push("Op welk moment kijkers afhaken is niet te zien: de platforms leveren via Metricool alleen de gemiddelde kijktijd, geen verloop per seconde.");
  if (!m.all.some((v) => (v.linkClicks ?? 0) > 0 || (v.conversions ?? 0) > 0)) gaps.push("Websiteklikken en aanvragen worden niet per video gemeten. Commerciële afsluitingen zijn daarom alleen op bereik en interactie beoordeeld.");
  if (coverage.total && coverage.structure < coverage.total * 0.5) gaps.push(`De opbouw van het middenstuk is bij ${coverage.structure} van ${coverage.total} video's herkend (afgeleid uit hook en caption, niet uit het beeld).`);
  else if (coverage.total) gaps.push("De opbouw van het middenstuk is afgeleid uit hook en caption, niet uit het beeld zelf.");
  if (!coverage.filmStyle) gaps.push("Filmstijl, montagetempo en overgangen zijn nog niet per video vastgelegd. Daar doet dit advies geen uitspraak over.");
  if (coverage.total && coverage.retention < coverage.total * 0.5) gaps.push(`Kijktijd is bekend bij ${coverage.retention} van ${coverage.total} video's.`);

  return { sufficient: m.sufficient, videoCount: m.videoCount, sections, priorities, nextShoot, phases, ctaGoals: goals, coverage, gaps };
}

/* ------------------------------------------------------------------ *
 * Script Engine
 * ------------------------------------------------------------------ */

/** Korte briefing voor de scriptschrijver: wat doen, wat laten, wat testen. */
export function advicePromptText(a: ContentAdvice, learned: Array<{ title: string; verdict: "effectief" | "niet_effectief" }> = []): string {
  if (!a.videoCount) return "";
  const line = (i: AdviceItem) => `- ${i.title}${i.application ? `: ${i.application.replace(/ Voorbeeld dat werkte.*$/, "")}` : `: ${i.advice}`} (${i.proof === "bewezen" ? "bewezen" : "hypothese"})`;
  const parts = [
    "CONTENTADVIES (wat gaan we nu beter doen; bewezen = uit de resultaten van deze klant, hypothese = nog te testen)",
    a.sections.meer.length ? `Meer doen:\n${a.sections.meer.slice(0, 4).map(line).join("\n")}` : "",
    a.sections.blijven.length ? `Blijven toepassen:\n${a.sections.blijven.slice(0, 3).map(line).join("\n")}` : "",
    a.sections.minder.length ? `Minder doen:\n${a.sections.minder.slice(0, 3).map((i) => `- ${i.title}: ${i.advice}`).join("\n")}` : "",
    a.sections.testen.length ? `Testen in hooguit één of twee scripts van deze sessie:\n${a.sections.testen.slice(0, 2).map(line).join("\n")}` : "",
    learned.length ? `Uitkomst van eerder advies:\n${learned.slice(0, 5).map((l) => `- ${l.title}: ${l.verdict === "effectief" ? "bewezen effectief, blijven doen" : "niet effectief gebleken, niet herhalen"}`).join("\n")}` : "",
  ].filter(Boolean);
  return parts.length > 1 ? parts.join("\n") : "";
}

/* ------------------------------------------------------------------ *
 * Leerlus: is het advies toegepast, en wat leverde het op?
 * ------------------------------------------------------------------ */

export type AdviceOutcome = {
  /** Unieke video's die na het advies online kwamen (minstens zeven dagen oud). */
  videosAfter: number;
  /** Daarvan de video's waarin het advies is toegepast. */
  matched: number;
  median: number | null;
  hits: number;
  before: number | null;
  verdict: "effectief" | "niet_effectief" | null;
  note: string;
  videoIds: string[];
  measuredAt: string;
};

export function matchesTarget(v: MemoryVideo, target: { dimension: AdviceDim; label: string }, ctx: AdviceContext): boolean {
  switch (target.dimension) {
    case "format": return v.format === target.label;
    case "hook": return v.hookTypes.includes(target.label);
    case "cta": return v.cta === target.label;
    case "lengte": return lengthBucket(v.durationSeconds) === target.label;
    case "opbouw": return ctx.structures?.[v.id] === target.label;
    case "filmstijl": return ctx.styles?.[v.id] === target.label;
  }
}

/**
 * Controleert aan de hand van de video's die ná het advies online kwamen of het
 * is toegepast en wat het opleverde. Een oordeel volgt pas bij minstens drie
 * video's; bij zes video's is het definitief. Eén uitschieter beslist niets:
 * het oordeel rust op de mediaan en het aandeel boven normaal.
 */
export function measureAdvice(
  section: AdviceSection,
  target: { dimension: AdviceDim; label: string } | null,
  since: string,
  m: ContentMemory,
  ctx: AdviceContext,
  now: Date = new Date(),
): { executed: boolean; outcome: AdviceOutcome | null } {
  if (!target) return { executed: false, outcome: null };
  const after = uniq(m.all.filter((v) => v.publishedOn && v.publishedOn > since));
  const before = uniq(m.all.filter((v) => !v.publishedOn || v.publishedOn <= since));
  const matched = after.filter((v) => matchesTarget(v, target, ctx));
  const base = { videosAfter: after.length, matched: matched.length, measuredAt: now.toISOString() };

  if (section === "minder") {
    if (after.length < 3) return { executed: false, outcome: null };
    const shareBefore = before.length ? before.filter((v) => matchesTarget(v, target, ctx)).length / before.length : 0;
    const shareAfter = matched.length / after.length;
    const executed = matched.length === 0 || shareAfter <= shareBefore / 2;
    if (!executed || after.length < 4) return { executed, outcome: null };
    const med = r2(median(after.map((v) => v.perf)) ?? 1);
    const prev = r2(median(before.map((v) => v.perf)) ?? 1);
    const verdict = med >= prev * 1.1 ? "effectief" : after.length >= 6 && med <= prev * 0.9 ? "niet_effectief" : after.length >= 6 ? "niet_effectief" : null;
    return {
      executed,
      outcome: {
        ...base, median: med, before: prev, hits: after.filter((v) => v.perf >= 1).length, verdict, videoIds: after.map((v) => v.id),
        note: `De ${after.length} video's sindsdien scoren gemiddeld ${fx(med)} normaal, tegen ${fx(prev)} daarvoor. Indicatie: ook andere wijzigingen spelen mee.`,
      },
    };
  }

  const executed = matched.length >= 1;
  if (matched.length < 3) return { executed, outcome: null };
  const med = r2(median(matched.map((v) => v.perf)) ?? 1);
  const hits = matched.filter((v) => v.perf >= 1).length;
  const rate = hits / matched.length;
  let verdict: AdviceOutcome["verdict"] = null;
  if (med >= 1.2 && rate >= 0.65) verdict = "effectief";
  else if (matched.length >= 4 && med < 1 && rate <= 0.4) verdict = "niet_effectief";
  else if (matched.length >= 6) verdict = med >= 1.1 ? "effectief" : "niet_effectief";
  return {
    executed,
    outcome: {
      ...base, median: med, before: null, hits, verdict, videoIds: matched.map((v) => v.id),
      note: `${hits} van ${matched.length} video's waarin dit is toegepast scoorden boven normaal, gemiddeld ${fx(med)}.${verdict ? "" : " Nog te wisselend voor een oordeel; bij zes video's volgt de conclusie."}`,
    },
  };
}

/** Bewezen patronen van één klant, in algemene termen (geen klantspecifieke formats). */
export function provenPatterns(m: ContentMemory, ctx: AdviceContext = {}): Array<{ dimension: AdviceDim; label: string; medianPerf: number }> {
  if (!m.sufficient) return [];
  return buildGroups(m, ctx)
    .filter((g) => g.dimension !== "format" && g.dimension !== "lengte" && !SKIP(g) && g.status === "bewezen")
    .map((g) => ({ dimension: g.dimension, label: g.label, medianPerf: g.medianPerf }));
}
