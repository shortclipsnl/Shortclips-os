/**
 * Prestatie-analyse voor de Script Engine — puur rekenwerk, geen database.
 *
 * Input: alle gepubliceerde posts van één klant met hun meest recente
 * Metricool-meting. Output: wat aantoonbaar beter en slechter werkt (hooktype,
 * call to action, videolengte, kijktijd), plus top- en flopvideo's.
 *
 * Uitgangspunten (zie Script Engine controlerapport, 12 nov 2026):
 *  - Alleen video's tellen mee. Losse foto- of aanbodposts (zoals de Facebook-
 *    aanbodposts van Koops) zijn geen Shortclips-content en vertekenen de top.
 *  - Platforms worden niet door elkaar vergeleken: elke video krijgt een score
 *    t.o.v. de mediaan van zijn eigen platform bij deze klant.
 *  - Video's jonger dan MIN_AGE_DAYS tellen niet mee in top/flop (cijfers lopen
 *    nog op).
 *  - Onder MIN_VIDEOS of MIN_GROUP wordt niets geconcludeerd: dan staat er
 *    "onvoldoende data" in plaats van een conclusie.
 *  - Kijktijd = gemiddelde kijkduur in seconden (Metricool levert die voor alle
 *    platforms). Het Metricool-veld completion_rate betekent per platform iets
 *    anders (TikTok: volledig uitgekeken, Instagram zonder lengte: niet
 *    weggeswiped) en wordt daarom niet onderling vergeleken. "% bekeken" tonen
 *    we alleen als de videolengte bekend is.
 *  - Het blijft correlatie, geen causaliteit. Dat staat ook letterlijk in de
 *    briefing aan de schrijver.
 */

export type PubInput = {
  id: string;
  platform: string;
  publishedAt: Date | null;
  caption: string | null;
  durationSeconds: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watchTimeSeconds: number;
  avgWatchSeconds: number | null;
  completionRate: number | null;
  /** Eerste meetdag van deze publicatie (YYYY-MM-DD). */
  firstMeasuredOn: string | null;
  /** Scripttitel/-hook als de publicatie aan de contentplanning gekoppeld kon worden. */
  scriptTitle?: string | null;
  scriptHook?: string | null;
};

export type InsightVideo = {
  id: string;
  platform: string;
  publishedOn: string | null;
  hook: string;
  title: string | null;
  views: number;
  /** Views t.o.v. de mediaan van hetzelfde platform bij deze klant (1 = gemiddeld). */
  score: number;
  /** Deel van de video dat gemiddeld bekeken wordt (alleen als de lengte bekend is). */
  watchedShare: number | null;
  avgWatchSeconds: number | null;
  durationSeconds: number | null;
  engagementRate: number;
  cta: string;
  hookTypes: string[];
};

export type InsightGroup = {
  dimension: "hook" | "cta" | "lengte";
  label: string;
  n: number;
  /** Mediaan van de platformscore (1 = klantgemiddelde). */
  medianScore: number;
  /** Mediaan kijkduur t.o.v. de platformmediaan (1 = normaal), alleen video's met kijktijddata. */
  medianWatchScore: number | null;
  /** Mediaan gemiddelde kijkduur in seconden. */
  medianWatchSeconds: number | null;
  nWatch: number;
  verdict: "beter" | "slechter" | "neutraal";
};

export type PerformanceInsights = {
  sufficient: boolean;
  /** Aantal geanalyseerde (rijpe) video's. */
  videoCount: number;
  /** Totaal aantal publicaties, incl. niet-video en te jonge posts. */
  publicationCount: number;
  excludedNonVideo: number;
  excludedTooYoung: number;
  withRetention: number;
  linkedToPlanning: number;
  measuredSince: string | null;
  platforms: Array<{ platform: string; n: number; medianViews: number }>;
  /** Mediaan gemiddelde kijkduur (sec) over alle geanalyseerde video's. */
  overallWatchSeconds: number | null;
  top: InsightVideo[];
  flop: InsightVideo[];
  groups: InsightGroup[];
  /** Kant-en-klare conclusies in gewone taal (alleen waar de data het draagt). */
  findings: string[];
};

export const MIN_VIDEOS = 8;
export const MIN_GROUP = 3;
export const MIN_AGE_DAYS = 3;
const BETTER = 1.25;
const WORSE = 0.8;
/** Kijkduur-afwijking t.o.v. normaal voordat we het noemen (±15%). */
const WATCH_BETTER = 1.15;
const WATCH_WORSE = 0.85;

/* ------------------------------------------------------------------ *
 * Tekstherkenning in captions
 * ------------------------------------------------------------------ */

/** Normaliseert 'mooie' unicode-letters (𝗚𝗲𝘄𝗼𝗼𝗻 → Gewoon) en witruimte. */
export function normalizeText(s: string): string {
  return s.normalize("NFKC").replace(/[​-‍️]/g, "").replace(/[ \t]+/g, " ").trim();
}

const LINE_NOISE = /^[\s\p{Extended_Pictographic}\p{S}|:·•\-–—]*$/u;
const FOOTER_LINE = /^(📍|📞|📩|📲|📧|☎|✉|📱|🌐|#|www\.|https?:)/u;

/** De openingszin van de caption: komt bij Shortclips vrijwel altijd overeen met de hook van de video. */
export function hookLine(caption: string | null | undefined): string {
  if (!caption) return "";
  const lines = normalizeText(caption).split(/\n+/).map((l) => l.trim()).filter((l) => l && !LINE_NOISE.test(l) && !FOOTER_LINE.test(l));
  // Korte labelregel ("UITGELICHT ✨") is geen hook: neem dan de volgende regel erbij.
  let first = lines[0] ?? "";
  if (first.replace(/[^\p{L}\p{N}]/gu, "").length < 15 && lines[1]) first = lines[1];
  const m = first.match(/^(.{8,}?[?!.])(\s|$)/u);
  const sentence = (m ? m[1] : first).trim();
  return sentence.length > 140 ? sentence.slice(0, 137).trimEnd() + "..." : sentence;
}

const QUESTION_START = /^(wat|wie|waar|waarom|wanneer|hoe|hoeveel|welke|welk|is|zijn|kan|kun|mag|moet|wil|ben|heb|zou|weet|denk)\b/i;
const CURIOSITY_START = /^(dit|deze|zo|daarom|hierom|niemand|nooit|stop|let op|wist je)\b/i;

/** Hooktypes (meerdere mogelijk) op basis van de openingszin. */
export function classifyHook(hook: string): string[] {
  const h = hook.trim();
  if (!h) return [];
  const tags: string[] = [];
  if (h.includes("?") || QUESTION_START.test(h)) tags.push("vraag");
  if (/€|\beuro\b|\d/.test(h)) tags.push("prijs of getal");
  const capsWords = (h.match(/\b[A-ZÀ-Ý]{3,}\b/g) ?? []).filter((w) => !/^(BMW|AMG|SUV|BTW|CEO|USA|XXL|EUR|DIY)$/.test(w));
  if (capsWords.length > 0) tags.push("nadruk in hoofdletters");
  if (CURIOSITY_START.test(h)) tags.push("nieuwsgierigheid (dit/deze)");
  if (/\b(jij|je|jouw|u|uw)\b/i.test(h)) tags.push("spreekt kijker direct aan");
  if (!tags.length) tags.push("stelling of mededeling");
  return tags;
}

/** Belangrijkste call to action in de caption (één label). */
export function classifyCta(caption: string | null | undefined): string {
  if (!caption) return "geen duidelijke CTA";
  const c = normalizeText(caption).toLowerCase();
  if (/\bpoll\b|kies hieronder|stem (hieronder|in)|\bstemmen\b/.test(c)) return "poll";
  if (/\b(gok|raad|raden|schat)\b/.test(c) && /\?/.test(c)) return "raden/gokken";
  if (/laat (het )?(weten|horen)|\bcomment|in de reacties|reageer|vertel (het )?(ons|me)|tag (een|iemand|je)/.test(c)) return "reactie vragen";
  if (/bezichtig|open huis|kom (langs|kijken)|plan (een|je)|maak (een )?afspraak|proefrit/.test(c)) return "langskomen/afspraak";
  if (/\b(bel|app|mail|dm|stuur)\b.*\b(ons|me|gerust|direct)\b|neem (gerust )?contact|vraag (vrijblijvend|gerust)/.test(c)) return "contact opnemen";
  if (/link in (de )?bio|bekijk (de|onze) website|via de link/.test(c)) return "link/website";
  if (/\bvolg (ons|voor|mij)|\bvolgen\b/.test(c)) return "volgen";
  if (/\bdeel (deze|dit|met)|stuur (dit|deze) door/.test(c)) return "delen";
  return "geen duidelijke CTA";
}

export function lengthBucket(sec: number | null | undefined): string | null {
  if (!sec || sec <= 0) return null;
  if (sec < 20) return "korter dan 20 sec";
  if (sec < 35) return "20-35 sec";
  if (sec < 50) return "35-50 sec";
  if (sec < 75) return "50-75 sec";
  return "langer dan 75 sec";
}

/* ------------------------------------------------------------------ *
 * Rekenhulpen
 * ------------------------------------------------------------------ */

export function median(xs: number[]): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function isVideo(p: PubInput): boolean {
  if (p.platform === "tiktok" || p.platform === "youtube") return true;
  if (p.durationSeconds && p.durationSeconds > 0) return true;
  if (p.avgWatchSeconds != null || p.completionRate != null) return true;
  return p.watchTimeSeconds > 0;
}

const pct = (x: number | null) => (x == null ? "?" : `${Math.round(x * 100)}%`);
const fmtViews = (n: number) => n.toLocaleString("nl-NL");

/* ------------------------------------------------------------------ *
 * Analyse
 * ------------------------------------------------------------------ */

export function analyzePerformance(pubs: PubInput[], now: Date = new Date()): PerformanceInsights {
  const videos = pubs.filter(isVideo);
  const excludedNonVideo = pubs.length - videos.length;
  const cutoff = now.getTime() - MIN_AGE_DAYS * 86_400_000;
  const mature = videos.filter((p) => !p.publishedAt || p.publishedAt.getTime() <= cutoff);
  const excludedTooYoung = videos.length - mature.length;

  // Mediaan per platform (views en kijkduur) → genormaliseerde scores per video.
  const byPlatform = new Map<string, PubInput[]>();
  for (const p of mature) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p]);
  const viewMedian = new Map<string, number>();
  const watchMedian = new Map<string, number | null>();
  for (const [pl, ps] of byPlatform) {
    viewMedian.set(pl, Math.max(1, median(ps.map((p) => p.views)) ?? 1));
    watchMedian.set(pl, median(ps.map((p) => p.avgWatchSeconds).filter((x): x is number => x != null && x > 0)));
  }

  type Item = InsightVideo & { watchScore: number | null };
  const items: Item[] = mature.map((p) => {
    const hook = normalizeText(p.scriptHook || "") || hookLine(p.caption);
    const interactions = p.likes + p.comments + p.shares + p.saves;
    const wm = watchMedian.get(p.platform) ?? null;
    return {
      id: p.id,
      platform: p.platform,
      publishedOn: p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : null,
      hook,
      title: p.scriptTitle ?? null,
      views: p.views,
      score: p.views / (viewMedian.get(p.platform) ?? 1),
      watchedShare: p.avgWatchSeconds != null && p.durationSeconds && p.durationSeconds > 0 ? Math.min(1, p.avgWatchSeconds / p.durationSeconds) : null,
      avgWatchSeconds: p.avgWatchSeconds,
      durationSeconds: p.durationSeconds,
      engagementRate: p.views > 0 ? interactions / p.views : 0,
      cta: classifyCta(p.caption),
      hookTypes: classifyHook(hookLine(p.caption) || hook),
      watchScore: p.avgWatchSeconds != null && p.avgWatchSeconds > 0 && wm ? p.avgWatchSeconds / wm : null,
    };
  });

  const watchSecs = items.map((i) => i.avgWatchSeconds).filter((x): x is number => x != null && x > 0);
  const overallWatchSeconds = median(watchSecs);
  const firstMeasured = pubs.map((p) => p.firstMeasuredOn).filter((x): x is string => !!x).sort()[0] ?? null;

  const base = {
    videoCount: items.length,
    publicationCount: pubs.length,
    excludedNonVideo,
    excludedTooYoung,
    withRetention: watchSecs.length,
    linkedToPlanning: pubs.filter((p) => p.scriptTitle).length,
    measuredSince: firstMeasured,
    platforms: [...byPlatform.entries()].map(([platform, ps]) => ({ platform, n: ps.length, medianViews: Math.round(median(ps.map((p) => p.views)) ?? 0) })).sort((a, b) => b.n - a.n),
    overallWatchSeconds: overallWatchSeconds != null ? Math.round(overallWatchSeconds * 10) / 10 : null,
  };

  if (items.length < MIN_VIDEOS) {
    return { ...base, sufficient: false, top: [], flop: [], groups: [], findings: [] };
  }

  const strip = ({ watchScore: _w, ...v }: Item): InsightVideo => v;
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 5);
  const flop = sorted.slice(-3).reverse().filter((f) => !top.some((t) => t.id === f.id));

  // Groepen: hooktype (meerdere per video), CTA, lengte.
  const groups: InsightGroup[] = [];
  const addGroups = (dimension: InsightGroup["dimension"], keyOf: (i: Item) => string[]) => {
    const map = new Map<string, Item[]>();
    for (const i of items) for (const k of keyOf(i)) map.set(k, [...(map.get(k) ?? []), i]);
    for (const [label, vs] of map) {
      if (vs.length < MIN_GROUP) continue;
      const ms = median(vs.map((v) => v.score)) ?? 1;
      const ws = vs.map((v) => v.watchScore).filter((x): x is number => x != null);
      const wsec = vs.map((v) => v.avgWatchSeconds).filter((x): x is number => x != null && x > 0);
      const verdict: InsightGroup["verdict"] = ms >= BETTER ? "beter" : ms <= WORSE ? "slechter" : "neutraal";
      groups.push({
        dimension, label, n: vs.length,
        medianScore: Math.round(ms * 100) / 100,
        medianWatchScore: ws.length >= MIN_GROUP ? Math.round((median(ws) ?? 1) * 100) / 100 : null,
        medianWatchSeconds: wsec.length >= MIN_GROUP ? Math.round((median(wsec) ?? 0) * 10) / 10 : null,
        nWatch: ws.length,
        verdict,
      });
    }
  };
  addGroups("hook", (i) => i.hookTypes);
  addGroups("cta", (i) => [i.cta]);
  addGroups("lengte", (i) => { const b = lengthBucket(i.durationSeconds); return b ? [b] : []; });

  // Conclusies in gewone taal.
  const findings: string[] = [];
  const subject = (g: InsightGroup) =>
    g.dimension === "hook" ? `Hooks met "${g.label}"` : g.dimension === "cta" ? `Video's met CTA "${g.label}"` : `Video's van ${g.label}`;
  const viewsLine = (g: InsightGroup) =>
    `${subject(g)} halen ${g.medianScore >= 1 ? `${g.medianScore.toFixed(1)}x` : `${Math.round(g.medianScore * 100)}% van`} de normale views (n=${g.n})`;
  for (const g of groups.filter((g) => g.verdict === "beter").sort((a, b) => b.medianScore - a.medianScore)) findings.push(`WERKT: ${viewsLine(g)}.`);
  for (const g of groups.filter((g) => g.verdict === "slechter").sort((a, b) => a.medianScore - b.medianScore)) findings.push(`WERKT MINDER: ${viewsLine(g)}.`);

  for (const g of [...groups].sort((a, b) => (b.medianWatchScore ?? 1) - (a.medianWatchScore ?? 1))) {
    if (g.medianWatchScore == null) continue;
    if (g.medianWatchScore < WATCH_BETTER && g.medianWatchScore > WATCH_WORSE) continue;
    const up = g.medianWatchScore >= WATCH_BETTER;
    findings.push(`${up ? "KIJKTIJD OMHOOG" : "KIJKTIJD OMLAAG"}: ${subject(g)} worden ${up ? `${Math.round((g.medianWatchScore - 1) * 100)}% langer` : `${Math.round((1 - g.medianWatchScore) * 100)}% korter`} bekeken dan normaal${g.medianWatchSeconds != null && base.overallWatchSeconds != null ? ` (${g.medianWatchSeconds} sec tegen ${base.overallWatchSeconds} sec)` : ""} (n=${g.nWatch}).`);
  }

  const lengthGroups = groups.filter((g) => g.dimension === "lengte");
  if (lengthGroups.length >= 2) {
    const best = [...lengthGroups].sort((a, b) => b.medianScore - a.medianScore)[0];
    findings.push(`BESTE LENGTE op views: ${best.label} (${best.medianScore.toFixed(1)}x normaal, n=${best.n}; lengte bekend van ${items.filter((i) => i.durationSeconds).length} video's).`);
  }

  return { ...base, sufficient: true, top: top.map(strip), flop: flop.map(strip), groups, findings };
}

/* ------------------------------------------------------------------ *
 * Briefing-tekst voor de schrijver
 * ------------------------------------------------------------------ */

function videoLine(v: InsightVideo): string {
  const bits = [
    `${v.platform}`,
    `${fmtViews(v.views)} views (${v.score.toFixed(1)}x normaal)`,
    v.avgWatchSeconds != null ? `${Math.round(v.avgWatchSeconds)} sec gemiddeld bekeken${v.watchedShare != null ? ` (${pct(v.watchedShare)} van de video)` : ""}` : "",
    v.durationSeconds ? `${v.durationSeconds} sec` : "",
    `CTA: ${v.cta}`,
  ].filter(Boolean).join(", ");
  return `- "${v.hook || v.title || "(geen caption)"}"${v.title && v.hook ? ` [script: ${v.title}]` : ""} — ${bits}`;
}

export function insightsToPromptText(ins: PerformanceInsights, opts: { isAd?: boolean } = {}): string {
  const head = `RESULTATEN UIT METRICOOL (echte cijfers van gepubliceerde video's van deze klant; ${ins.videoCount} video's geanalyseerd${ins.measuredSince ? `, gemeten sinds ${ins.measuredSince}` : ""}).`;
  if (!ins.sufficient) {
    return `${head}\nOnvoldoende data (${ins.videoCount} video's, minimaal ${MIN_VIDEOS} nodig): trek hier GEEN conclusies uit over hooks, lengte of CTA. Schrijf vanuit het handboek en de klantcontext.`;
  }
  const parts = [
    head,
    opts.isAd
      ? "LET OP: dit is organisch bereik. Het zegt iets over wat de doelgroep aanspreekt, niet over wat in een advertentie converteert."
      : "Gebruik dit als stuur, niet als mal: bouw voort op wat werkt, vermijd wat aantoonbaar minder werkt, en kopieer nooit letterlijk een eerdere hook. Het zijn verbanden, geen bewezen oorzaken.",
    ins.findings.length ? `Wat de cijfers laten zien:\n- ${ins.findings.join("\n- ")}` : "De cijfers laten (nog) geen duidelijke verschillen zien tussen hooktypes, CTA's of lengtes.",
    `Best presterende video's (spiegel de aanpak, niet de woorden):\n${ins.top.map(videoLine).join("\n")}`,
    ins.flop.length ? `Slechtst presterende video's (vermijd deze aanpak):\n${ins.flop.map(videoLine).join("\n")}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

/** Korte, leesbare regels voor het blok "Gebaseerd op" in de generator. */
export function insightsBasis(ins: PerformanceInsights): string[] {
  if (!ins.publicationCount) return ["Geen Metricool-resultaten gekoppeld aan deze klant"];
  if (!ins.sufficient) return [`Metricool: ${ins.videoCount} video's met resultaten, onvoldoende data voor conclusies`];
  const better = ins.groups.filter((g) => g.verdict === "beter").length;
  const worse = ins.groups.filter((g) => g.verdict === "slechter").length;
  return [
    `${ins.videoCount} video's met resultaten uit Metricool geanalyseerd`,
    `${better} aanpak${better === 1 ? "" : "ken"} bovengemiddeld, ${worse} onder klantgemiddelde`,
    ins.withRetention ? `Kijktijd meegenomen van ${ins.withRetention} video's` : "Geen kijktijddata beschikbaar",
  ];
}
