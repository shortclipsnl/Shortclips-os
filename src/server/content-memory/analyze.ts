/**
 * Contentgeheugen: puur rekenwerk (geen database, geen AI).
 *
 * Input: alle gepubliceerde video's van één klant met hun laatste meting uit
 * Metricool, plus (optioneel) het format dat de AI eraan gaf. Output: wat
 * aantoonbaar werkt en wat niet, per format, hook, call to action en lengte,
 * met per inzicht hoeveel video's het draagt.
 *
 * Uitgangspunten:
 *  - Platforms worden niet door elkaar vergeleken: elke video krijgt een score
 *    t.o.v. de mediaan van zijn eigen platform bij deze klant (1 = normaal).
 *  - Prestatie = 60% views-score + 40% engagement-score (beide per platform).
 *  - Video's jonger dan MIN_AGE_DAYS tellen niet mee (cijfers lopen nog op).
 *  - Eén video is nooit een patroon. Bewijsniveau hangt af van het aantal
 *    video's én hoe consequent het resultaat is.
 *  - Het blijft correlatie, geen bewezen oorzaak.
 */

import { embedUrl as platformEmbedUrl, type Platform } from "@/lib/resultaten-overzicht";

export const MIN_AGE_DAYS = 7;
export const MIN_VIDEOS = 8;
const BETTER = 1.2;
const WORSE = 0.8;

export type MemoryInput = {
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
  avgWatchSeconds: number | null;
  /** Bereik (unieke kijkers), 0 = niet geleverd. */
  reach?: number;
  /** Aandeel dat de video uitkeek (0..1), zoals Metricool het levert. */
  completionRate?: number | null;
  /** Linkklikken en conversies, alleen als een koppeling ze levert (anders null). */
  linkClicks?: number | null;
  conversions?: number | null;
  followerDelta: number;
  externalUrl: string | null;
  thumbnail: string | null;
  /** Gesproken hook uit de Caption Maker, als de caption gekoppeld kon worden. */
  spokenHook: string | null;
  /** Titel uit de contentplanning (= scripttitel), als gekoppeld. */
  planTitle: string | null;
  planId: string | null;
  format: string | null;
};

export type Evidence = "een_video" | "verkennend" | "gemengd" | "aannemelijk" | "sterk";
export const EVIDENCE_LABEL: Record<Evidence, string> = {
  een_video: "Eén video",
  verkennend: "Verkennend",
  gemengd: "Wisselend",
  aannemelijk: "Aannemelijk",
  sterk: "Sterk onderbouwd",
};

export type MemoryVideo = {
  id: string;
  platform: string;
  publishedOn: string | null;
  title: string;
  planId: string | null;
  caption: string;
  hook: string;
  hookSource: "gesproken" | "caption";
  hookTypes: string[];
  cta: string;
  ctaText: string | null;
  format: string | null;
  durationSeconds: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  interactions: number;
  engagementRate: number;
  avgWatchSeconds: number | null;
  watchedShare: number | null;
  /** Bereik; null als het platform het niet levert. */
  reach: number | null;
  /** Retentie: gemiddeld deel van de video bekeken (0..1), null als onbekend. */
  retention: number | null;
  /** Linkklikken / conversies; null = niet gemeten (Metricool levert dit meestal niet). */
  linkClicks: number | null;
  conversions: number | null;
  followerDelta: number;
  /** Views t.o.v. platformmediaan. */
  viewScore: number;
  /** Engagement t.o.v. platformmediaan. */
  engScore: number;
  /** Gecombineerde prestatie (1 = normaal voor deze klant). */
  perf: number;
  externalUrl: string | null;
  /** Officiële speler van het platform, zodat de video in het portaal afspeelt. */
  embedUrl: string | null;
  thumbnail: string | null;
  why: string;
};

export type MemoryGroup = {
  dimension: "format" | "hook" | "cta" | "lengte";
  label: string;
  n: number;
  medianPerf: number;
  /** Aandeel video's dat boven normaal presteerde. */
  hitRate: number;
  medianViews: number;
  medianEngagement: number;
  medianWatchSeconds: number | null;
  verdict: "beter" | "slechter" | "neutraal";
  evidence: Evidence;
  /** Ontwikkeling: eerste helft vs tweede helft van de periode. */
  trend: "sterker" | "zwakker" | "stabiel" | null;
  examples: MemoryVideo[];
};

export type SuccessFormula = {
  format: string | null;
  hookType: string;
  cta: string;
  n: number;
  hits: number;
  medianPerf: number;
  examples: MemoryVideo[];
};

/**
 * Een terugkerend succes, direct gekoppeld aan de video's die het dragen.
 * Alleen gevuld bij voldoende data en minstens "aannemelijk" bewijs.
 */
export type MemorySuccess = {
  kind: "format" | "hook" | "cta" | "lengte" | "formule" | "kijktijd";
  /** Korte titel, bijvoorbeeld "Prijs in de hook". */
  title: string;
  /** Eén korte conclusie in gewone taal. */
  conclusion: string;
  /** Mediaan prestatie t.o.v. normaal (1 = normaal). */
  perf: number;
  hits: number;
  n: number;
  evidence: Evidence;
  videos: MemoryVideo[];
};

export type ContentMemory = {
  sufficient: boolean;
  videoCount: number;
  publicationCount: number;
  excludedNonVideo: number;
  excludedTooYoung: number;
  formatsLabeled: number;
  linkedToPlanning: number;
  spokenHooks: number;
  measuredFrom: string | null;
  measuredTo: string | null;
  platforms: Array<{ platform: string; n: number; medianViews: number; medianEngagement: number; totalViews: number; followerDelta: number }>;
  totalViews: number;
  totalInteractions: number;
  /** Alle geanalyseerde video's, beste eerst. */
  all: MemoryVideo[];
  topVideos: MemoryVideo[];
  flopVideos: MemoryVideo[];
  topHooks: MemoryVideo[];
  formats: MemoryGroup[];
  hooks: MemoryGroup[];
  ctas: MemoryGroup[];
  lengths: MemoryGroup[];
  formulas: SuccessFormula[];
  patterns: string[];
  successes: MemorySuccess[];
};

/* ------------------------------------------------------------------ *
 * Tekstherkenning
 * ------------------------------------------------------------------ */

export function normalizeText(s: string): string {
  return s.normalize("NFKC").replace(/[​-‍️]/g, "").replace(/[ \t]+/g, " ").trim();
}

const LINE_NOISE = /^[\s\p{Extended_Pictographic}\p{S}|:·•\-–]*$/u;
const FOOTER_LINE = /^(📍|📞|📩|📲|📧|☎|✉|📱|🌐|💶|📐|⚡|#|www\.|https?:)/u;

export function captionLines(caption: string | null | undefined): string[] {
  if (!caption) return [];
  return normalizeText(caption).split(/\n+/).map((l) => l.trim()).filter((l) => l && !LINE_NOISE.test(l) && !FOOTER_LINE.test(l));
}

/** De openingszin van de caption: bij Shortclips vrijwel altijd de hook van de video. */
export function hookLine(caption: string | null | undefined): string {
  const lines = captionLines(caption);
  let first = lines[0] ?? "";
  // Labelregel ("UITGELICHT ✨", "Binnenkort online 👀") is geen hook.
  if (first.replace(/[^\p{L}\p{N}]/gu, "").length < 22 && lines[1]) first = lines[1];
  const m = first.match(/^(.{8,}?[?!.…])(\s|$)/u);
  const sentence = (m ? m[1] : first).replace(/[\p{Extended_Pictographic}]/gu, "").trim();
  const chars = Array.from(sentence);
  return chars.length > 160 ? chars.slice(0, 157).join("").trimEnd() + "..." : sentence;
}

const QUESTION_START = /^(wat|wie|waar|waarom|wanneer|hoe|hoeveel|welke|welk|is|zijn|kan|kun|mag|moet|wil|ben|heb|zou|weet|denk)\b/i;
const CURIOSITY = /^(dit|deze|zo|daarom|hierom|niemand|nooit|stop|let op|wist je|binnenkort)\b/i;

export function classifyHook(hook: string): string[] {
  const h = hook.trim();
  if (!h) return [];
  const tags: string[] = [];
  if (h.includes("?") || QUESTION_START.test(h)) tags.push("Vraag");
  if (/€|\beuro\b|\bprijs\b|\bkost\b|\bbetaal/i.test(h)) tags.push("Prijs");
  else if (/\d/.test(h)) tags.push("Getal");
  if (CURIOSITY.test(h) || /\.\.\.|…|🤫|👀/.test(h)) tags.push("Nieuwsgierigheid");
  if (/\b(jij|je|jouw|u|uw)\b/i.test(h)) tags.push("Spreekt kijker aan");
  if (/\b(neemt? (je|jullie|u) mee|laat (je|jullie|u) .* zien|rondleiding|tour)\b/i.test(h)) tags.push("Rondleiding");
  if (!tags.length) tags.push("Stelling");
  return tags;
}

const CTA_RULES: Array<[string, RegExp]> = [
  ["Poll of keuze", /\bpoll\b|kies hieronder|stem (hieronder|in)|\bstemmen\b|welke (kies|zou|vind)/i],
  ["Raden", /\b(gok|raad|raden|schat)\b[^.!?\n]*\?/i],
  ["Reactie vragen", /laat (het )?(weten|horen)|\bcomment|in de reacties|reageer|vertel (het )?(ons|me)|tag (een|iemand|je)/i],
  ["Afspraak of bezichtiging", /bezichtig|open huis|kom (langs|kijken)|plan (een|je)|maak (een )?afspraak|proefrit|showroom/i],
  ["Contact opnemen", /\b(bel|app|mail|dm|stuur)\b[^.!?\n]*\b(ons|me|gerust|direct)\b|neem (gerust )?contact|vraag (vrijblijvend|gerust)/i],
  ["Website of link", /link in (de )?bio|bekijk (de|onze) website|via de link|op onze website|\.nl\b/i],
  ["Volgen", /\bvolg (ons|voor|mij)|\bvolgen\b/i],
  ["Opslaan of delen", /\bdeel (deze|dit|met)|stuur (dit|deze) door|sla (deze|dit) op|opslaan/i],
];

/** Type call to action + de exacte zin uit de caption. */
export function extractCta(caption: string | null | undefined): { type: string; text: string | null } {
  if (!caption) return { type: "Geen duidelijke CTA", text: null };
  const sentences = normalizeText(caption).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  // Van achter naar voren: de CTA staat meestal onderaan.
  for (const [type, re] of CTA_RULES) {
    for (let i = sentences.length - 1; i >= 0; i--) {
      if (re.test(sentences[i]) && !/^(www\.|https?:)\S+$/i.test(sentences[i].trim())) {
        const t = sentences[i].replace(/[\p{Extended_Pictographic}]/gu, "").trim();
        const chars = Array.from(t);
        return { type, text: chars.length > 180 ? chars.slice(0, 177).join("") + "..." : t };
      }
    }
  }
  return { type: "Geen duidelijke CTA", text: null };
}

export function lengthBucket(sec: number | null | undefined): string | null {
  if (!sec || sec <= 0) return null;
  if (sec < 20) return "Korter dan 20 sec";
  if (sec < 35) return "20 tot 35 sec";
  if (sec < 50) return "35 tot 50 sec";
  if (sec < 75) return "50 tot 75 sec";
  return "Langer dan 75 sec";
}

export function median(xs: number[]): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function isVideo(p: MemoryInput): boolean {
  if (p.platform === "tiktok" || p.platform === "youtube") return true;
  if (p.durationSeconds && p.durationSeconds > 0) return true;
  return p.avgWatchSeconds != null && p.avgWatchSeconds > 0;
}

export function captionKey(caption: string | null | undefined): string {
  if (!caption) return "";
  return normalizeText(caption).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
}

/** Afspeel-URL binnen het portaal (zelfde spelers als de Resultatenpagina, plus YouTube Shorts). */
export function videoEmbedUrl(platform: string, url: string | null): string | null {
  if (!url) return null;
  if (platform === "youtube") {
    const id = url.match(/(?:shorts\/|youtu\.be\/|[?&]v=)([\w-]{6,})/)?.[1];
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&rel=0` : null;
  }
  return platformEmbedUrl(platform as Platform, url);
}

const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn" };

const HOOK_TITLE: Record<string, string> = {
  Vraag: "Een vraag als hook",
  Prijs: "Prijs in de hook",
  Getal: "Een getal in de hook",
  Nieuwsgierigheid: "Nieuwsgierigheid wekken",
  "Spreekt kijker aan": "Kijker direct aanspreken",
  Rondleiding: "Rondleiding als opening",
  Stelling: "Stelling als opening",
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const fmtX = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;

/* ------------------------------------------------------------------ *
 * Analyse
 * ------------------------------------------------------------------ */

export function evidenceOf(n: number, hitRate: number, halvesAgree: boolean | null): Evidence {
  if (n <= 1) return "een_video";
  if (n <= 3) return "verkennend";
  const consistent = hitRate >= 0.65 || hitRate <= 0.35;
  if (!consistent) return "gemengd";
  if (n >= 8 && halvesAgree !== false) return "sterk";
  return "aannemelijk";
}

function whyText(v: Omit<MemoryVideo, "why">, overallWatch: number | null): string {
  const bits: string[] = [];
  if (v.viewScore >= 1.5) bits.push(`${fmtX(v.viewScore)} de normale views op ${PLATFORM_NAME[v.platform] ?? v.platform}`);
  if (v.engScore >= 1.3) bits.push(`${fmtX(v.engScore)} de normale interactie`);
  if (v.avgWatchSeconds != null && overallWatch && v.avgWatchSeconds >= overallWatch * 1.15)
    bits.push(`langer bekeken dan normaal (${Math.round(v.avgWatchSeconds)} tegen ${Math.round(overallWatch)} sec)`);
  const hook = v.hookTypes.filter((t) => t !== "Stelling");
  if (hook.length) bits.push(`hook met ${hook.map((h) => h.toLowerCase()).join(" en ")}`);
  if (v.cta !== "Geen duidelijke CTA") bits.push(`CTA: ${v.cta.toLowerCase()}`);
  return bits.length ? bits.join("; ") + "." : "Presteert rond het normale niveau.";
}

export function analyzeMemory(pubs: MemoryInput[], now: Date = new Date()): ContentMemory {
  const videos = pubs.filter(isVideo);
  const cutoff = now.getTime() - MIN_AGE_DAYS * 86_400_000;
  const mature = videos.filter((p) => !p.publishedAt || p.publishedAt.getTime() <= cutoff);

  const byPlatform = new Map<string, MemoryInput[]>();
  for (const p of mature) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p]);
  const vMed = new Map<string, number>();
  const eMed = new Map<string, number>();
  const er = (p: MemoryInput) => (p.views > 0 ? (p.likes + p.comments + p.shares + p.saves) / p.views : 0);
  for (const [pl, ps] of byPlatform) {
    vMed.set(pl, Math.max(1, median(ps.map((p) => p.views)) ?? 1));
    eMed.set(pl, Math.max(0.0001, median(ps.map(er)) ?? 0.0001));
  }
  const overallWatch = median(mature.map((p) => p.avgWatchSeconds).filter((x): x is number => x != null && x > 0));

  const items: MemoryVideo[] = mature.map((p) => {
    const spoken = p.spokenHook ? normalizeText(p.spokenHook) : "";
    const hook = spoken || hookLine(p.caption);
    const cta = extractCta(p.caption);
    const interactions = p.likes + p.comments + p.shares + p.saves;
    const viewScore = p.views / (vMed.get(p.platform) ?? 1);
    const engScore = er(p) / (eMed.get(p.platform) ?? 1);
    const base = {
      id: p.id,
      platform: p.platform,
      publishedOn: p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : null,
      title: p.planTitle || hookLine(p.caption) || "Video zonder caption",
      planId: p.planId,
      caption: p.caption ?? "",
      hook,
      hookSource: (spoken ? "gesproken" : "caption") as MemoryVideo["hookSource"],
      hookTypes: classifyHook(hookLine(p.caption) || hook),
      cta: cta.type,
      ctaText: cta.text,
      format: p.format,
      durationSeconds: p.durationSeconds,
      views: p.views,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      saves: p.saves,
      interactions,
      engagementRate: er(p),
      avgWatchSeconds: p.avgWatchSeconds,
      watchedShare: p.avgWatchSeconds != null && p.durationSeconds ? Math.min(1, p.avgWatchSeconds / p.durationSeconds) : null,
      reach: p.reach && p.reach > 0 ? p.reach : null,
      retention: p.avgWatchSeconds != null && p.avgWatchSeconds > 0 && p.durationSeconds
        ? Math.min(1, p.avgWatchSeconds / p.durationSeconds)
        : null,
      linkClicks: p.linkClicks ?? null,
      conversions: p.conversions ?? null,
      followerDelta: p.followerDelta,
      viewScore: r2(viewScore),
      engScore: r2(engScore),
      perf: r2(0.6 * Math.min(viewScore, 6) + 0.4 * Math.min(engScore, 4)),
      externalUrl: p.externalUrl,
      embedUrl: videoEmbedUrl(p.platform, p.externalUrl),
      thumbnail: p.thumbnail,
    };
    return { ...base, why: whyText(base, overallWatch) };
  });

  const dates = items.map((i) => i.publishedOn).filter((d): d is string => !!d).sort();
  const platforms = [...byPlatform.entries()].map(([platform, ps]) => ({
    platform,
    n: ps.length,
    medianViews: Math.round(median(ps.map((p) => p.views)) ?? 0),
    medianEngagement: median(ps.map(er)) ?? 0,
    totalViews: ps.reduce((a, p) => a + p.views, 0),
    followerDelta: ps.reduce((a, p) => a + (p.followerDelta || 0), 0),
  })).sort((a, b) => b.totalViews - a.totalViews);

  const base = {
    videoCount: items.length,
    publicationCount: pubs.length,
    excludedNonVideo: pubs.length - videos.length,
    excludedTooYoung: videos.length - mature.length,
    formatsLabeled: items.filter((i) => i.format).length,
    linkedToPlanning: items.filter((i) => i.planId).length,
    spokenHooks: items.filter((i) => i.hookSource === "gesproken").length,
    measuredFrom: dates[0] ?? null,
    measuredTo: dates[dates.length - 1] ?? null,
    platforms,
    totalViews: items.reduce((a, i) => a + i.views, 0),
    totalInteractions: items.reduce((a, i) => a + i.interactions, 0),
  };

  // Dezelfde video op meerdere platforms telt in de toplijsten maar één keer.
  const dedupe = (list: MemoryVideo[]) => {
    const seen = new Set<string>();
    return list.filter((v) => {
      const k = captionKey(v.caption) || v.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const sorted = [...items].sort((a, b) => b.perf - a.perf);
  const topVideos = dedupe(sorted).slice(0, 12);
  const flopVideos = dedupe([...sorted].reverse()).slice(0, 6).filter((f) => !topVideos.slice(0, 6).some((t) => t.id === f.id));
  const topHooks = dedupe(sorted.filter((v) => v.hook && v.hook.length >= 12)).slice(0, 10);

  const midDate = dates.length ? dates[Math.floor(dates.length / 2)] : null;
  const group = (dimension: MemoryGroup["dimension"], keyOf: (v: MemoryVideo) => string[]): MemoryGroup[] => {
    const map = new Map<string, MemoryVideo[]>();
    for (const v of items) for (const k of keyOf(v)) map.set(k, [...(map.get(k) ?? []), v]);
    return [...map.entries()].map(([label, vs]) => {
      const mp = median(vs.map((v) => v.perf)) ?? 1;
      const hitRate = vs.filter((v) => v.perf >= 1).length / vs.length;
      let trend: MemoryGroup["trend"] = null;
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
      const ws = vs.map((v) => v.avgWatchSeconds).filter((x): x is number => x != null && x > 0);
      return {
        dimension,
        label,
        n: vs.length,
        medianPerf: r2(mp),
        hitRate: r2(hitRate),
        medianViews: Math.round(median(vs.map((v) => v.views)) ?? 0),
        medianEngagement: median(vs.map((v) => v.engagementRate)) ?? 0,
        medianWatchSeconds: ws.length >= 2 ? Math.round((median(ws) ?? 0) * 10) / 10 : null,
        verdict: (mp >= BETTER ? "beter" : mp <= WORSE ? "slechter" : "neutraal") as MemoryGroup["verdict"],
        evidence: evidenceOf(vs.length, hitRate, halvesAgree),
        trend,
        examples: dedupe([...vs].sort((x, y) => y.perf - x.perf)).slice(0, 3),
      };
    }).sort((a, b) => b.medianPerf - a.medianPerf);
  };

  const formats = group("format", (v) => (v.format ? [v.format] : []));
  const hooks = group("hook", (v) => v.hookTypes);
  const ctas = group("cta", (v) => [v.cta]);
  const lengths = group("lengte", (v) => { const b = lengthBucket(v.durationSeconds); return b ? [b] : []; });

  // Succesformules: dezelfde combinatie format + hooktype + CTA bij meerdere sterke video's.
  const combos = new Map<string, MemoryVideo[]>();
  for (const v of items) {
    for (const h of v.hookTypes) {
      const k = `${v.format ?? "-"}|${h}|${v.cta}`;
      combos.set(k, [...(combos.get(k) ?? []), v]);
    }
  }
  const formulas: SuccessFormula[] = [...combos.entries()]
    .map(([k, vs]) => {
      const [format, hookType, cta] = k.split("|");
      const hits = vs.filter((v) => v.perf >= 1.2).length;
      return { format: format === "-" ? null : format, hookType, cta, n: vs.length, hits, medianPerf: r2(median(vs.map((v) => v.perf)) ?? 1), examples: dedupe([...vs].sort((a, b) => b.perf - a.perf)).slice(0, 3) };
    })
    .filter((f) => f.hits >= 2 && f.hits / f.n >= 0.6 && f.cta !== "Geen duidelijke CTA" && f.hookType !== "Stelling")
    .sort((a, b) => b.hits - a.hits || b.medianPerf - a.medianPerf)
    .filter((f, i, arr) => arr.findIndex((g) => g.examples[0]?.id === f.examples[0]?.id) === i)
    .slice(0, 4);

  if (items.length < MIN_VIDEOS) {
    return { ...base, sufficient: false, all: sorted, topVideos, flopVideos: [], topHooks, formats, hooks, ctas, lengths, formulas: [], patterns: [], successes: [] };
  }

  // Sterkste patronen in gewone taal (alleen waar minstens 4 video's het dragen).
  // Dezelfde selectie als gestructureerde successen, gekoppeld aan de video's.
  const patterns: string[] = [];
  const successes: MemorySuccess[] = [];
  const winners = (vs: MemoryVideo[]) => { const w = vs.filter((v) => v.perf >= 1); return (w.length ? w : vs).slice(0, 3); };
  const successTitle = (g: MemoryGroup) =>
    g.dimension === "format" ? g.label : g.dimension === "hook" ? HOOK_TITLE[g.label] ?? `Hook: ${g.label.toLowerCase()}` : g.dimension === "cta" ? `CTA: ${g.label.toLowerCase()}` : `Video's van ${g.label.toLowerCase()}`;
  const advice: Record<MemoryGroup["dimension"], string> = { format: "Vaker inplannen.", hook: "Gebruik deze opening vaker.", cta: "Sluit vaker zo af.", lengte: "Houd deze lengte aan." };
  const solid = (g: MemoryGroup) => g.evidence === "aannemelijk" || g.evidence === "sterk";
  const subject = (g: MemoryGroup) =>
    g.dimension === "format" ? `Het format "${g.label}"` : g.dimension === "hook" ? `Hooks met ${g.label.toLowerCase()}` : g.dimension === "cta" ? `De CTA "${g.label.toLowerCase()}"` : `Video's van ${g.label.toLowerCase()}`;
  for (const g of [...formats, ...hooks, ...ctas, ...lengths].filter((g) => g.verdict === "beter" && solid(g)).sort((a, b) => b.medianPerf - a.medianPerf).slice(0, 5)) {
    patterns.push(`${subject(g)} ${g.dimension === "hook" || g.dimension === "lengte" ? "presteren" : "presteert"} ${fmtX(g.medianPerf)} normaal; ${Math.round(g.hitRate * g.n)} van de ${g.n} video's scoorden boven gemiddeld.`);
    const hits = Math.round(g.hitRate * g.n);
    // "Geen duidelijke CTA" of een gewone stelling is geen herbruikbaar succes.
    if (g.label !== "Geen duidelijke CTA" && g.label !== "Stelling") successes.push({ kind: g.dimension, title: successTitle(g), conclusion: `${hits} van ${g.n} video's scoorden boven gemiddeld. ${advice[g.dimension]}`, perf: g.medianPerf, hits, n: g.n, evidence: g.evidence, videos: winners(g.examples) });
  }
  for (const f of formulas.slice(0, 2)) {
    patterns.push(`Terugkerende succesformule: ${f.format ? `${f.format} + ` : ""}hook met ${f.hookType.toLowerCase()} + CTA "${f.cta.toLowerCase()}" (${f.hits} van ${f.n} video's sterk).`);
    successes.push({
      kind: "formule",
      title: [f.format, `hook met ${f.hookType.toLowerCase()}`, `CTA ${f.cta.toLowerCase()}`].filter(Boolean).join(" + "),
      conclusion: `${f.hits} van ${f.n} video's met deze combinatie scoorden sterk. Herhaal de combinatie.`,
      perf: f.medianPerf,
      hits: f.hits,
      n: f.n,
      evidence: evidenceOf(f.n, f.hits / f.n, null),
      videos: winners(f.examples),
    });
  }
  const watchUp = [...hooks, ...lengths].filter((g) => g.medianWatchSeconds != null && overallWatch && g.medianWatchSeconds >= overallWatch * 1.15 && g.n >= 4)[0];
  if (watchUp && overallWatch) {
    patterns.push(`${subject(watchUp)} worden langer bekeken: ${watchUp.medianWatchSeconds} sec tegen ${Math.round(overallWatch * 10) / 10} sec normaal.`);
    successes.push({
      kind: "kijktijd",
      title: `Langer bekeken: ${successTitle(watchUp).charAt(0).toLowerCase()}${successTitle(watchUp).slice(1)}`,
      conclusion: `${String(watchUp.medianWatchSeconds).replace(".", ",")} sec kijktijd tegen ${String(Math.round(overallWatch * 10) / 10).replace(".", ",")} sec normaal.`,
      perf: watchUp.medianPerf,
      hits: Math.round(watchUp.hitRate * watchUp.n),
      n: watchUp.n,
      evidence: watchUp.evidence,
      videos: winners(watchUp.examples),
    });
  }

  return { ...base, sufficient: true, all: sorted, topVideos, flopVideos, topHooks, formats, hooks, ctas, lengths, formulas, patterns, successes };
}
