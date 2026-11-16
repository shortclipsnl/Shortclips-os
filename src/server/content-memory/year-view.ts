/**
 * Contentgeheugen voor de klant, per kalenderjaar (puur rekenwerk).
 *
 * Basis: exact dezelfde videolijst als de Resultatenpagina (één regel per
 * video, crossposts samengevoegd, cijfers = som van de platforms). Daarop
 * leggen we de analyse van het Contentgeheugen over dezelfde periode:
 * format, type opening, lengte, CTA en opbouw per video, plus de prestatie
 * t.o.v. het normale niveau op hetzelfde platform.
 *
 * Twee maatstaven, bewust gescheiden:
 *  - "x je gemiddelde video": weergaven van de video gedeeld door die van een
 *    gemiddelde video van dit jaar (de middelste, zodat één uitschieter het
 *    beeld niet vertekent). Dit is wat de klant op elke kaart ziet.
 *  - Patronen: of een video boven normaal scoorde wordt binnen hetzelfde
 *    platform bepaald (perf >= 1), zodat een video die op vier platforms staat
 *    niet automatisch "beter" is dan een video op één platform.
 * Alleen echte cijfers; bij te weinig video's geen conclusies.
 */

import type { PortalVideo } from "@/server/portal-videos";
import type { MemoryAi } from "./index";
import { classifyHook, lengthBucket, median, type ContentMemory, type MemoryVideo } from "./analyze";

/** Vanaf zoveel geanalyseerde video's (uniek, minstens 7 dagen online) tonen we patronen. */
export const MIN_YEAR_VIDEOS = 6;
const ABOVE = 1.2;

export type Opening = { text: string; source: "transcript" | "script" };

export type YearVideo = PortalVideo & {
  /** Weergaven t.o.v. een gemiddelde video van dit jaar (1 = gemiddeld). */
  vsAverage: number | null;
  /** Aantoonbaar bovengemiddeld (minstens 1,2x de gemiddelde video). */
  above: boolean;
  /** Prestatie binnen het eigen platform (1 = normaal); null = nog niet geanalyseerd. */
  perf: number | null;
  format: string | null;
  hookTypes: string[];
  cta: string | null;
  ctaText: string | null;
  durationSeconds: number | null;
  lengthLabel: string | null;
  structure: string | null;
  opening: Opening | null;
};

export type GroupKind = "patroon" | "signaal" | "uitschieter" | "geen";
export type GroupDimension = "format" | "hook" | "lengte" | "cta" | "opbouw";

export type YearGroup = {
  dimension: GroupDimension;
  label: string;
  /** Unieke video's (crossposts één keer). */
  n: number;
  /** Video's die binnen hun platform boven normaal scoorden. */
  hits: number;
  medianPerf: number;
  medianViews: number;
  medianInteractions: number;
  /** Mediaan weergaven van deze groep t.o.v. de gemiddelde video. */
  vsAverage: number | null;
  kind: GroupKind;
  videos: YearVideo[];
  best: YearVideo;
};

export type HeroCard = { key: "format" | "opening" | "lengte"; label: string; value: string; video: YearVideo; n: number; kind: GroupKind; why: string };

export type YearPeriod = { from: string; to: string; startedOn: string | null; startedLate: boolean; year: number };

export type YearView = {
  period: YearPeriod;
  videoCount: number;
  analyzedCount: number;
  tooYoung: number;
  totalViews: number;
  totalInteractions: number;
  platforms: Array<{ platform: string; videos: number; views: number; interactions: number }>;
  averageViews: number;
  averageInteractions: number;
  sufficient: boolean;
  top: YearVideo[];
  hero: HeroCard[];
  patterns: YearGroup[];
  early: YearGroup[];
  formats: YearGroup[];
  openings: YearVideo[];
  ctas: YearGroup[];
  lastMeasured: string | null;
};

/* ------------------------------------------------------------------ *
 * Periode
 * ------------------------------------------------------------------ */

const amsDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });

/** 1 januari van dit kalenderjaar, of de latere startdatum van de klant. */
export function yearPeriod(now: Date, startedOn: string | null): YearPeriod {
  const to = amsDay(now);
  const year = Number(to.slice(0, 4));
  const jan1 = `${year}-01-01`;
  const started = startedOn ? startedOn.slice(0, 10) : null;
  const startedLate = !!started && started > jan1 && started <= to;
  return { from: startedLate ? started! : jan1, to, startedOn: started, startedLate, year };
}

/* ------------------------------------------------------------------ *
 * Openingszinnen
 * ------------------------------------------------------------------ */

/** De eerste uitgesproken zin uit een transcript, letterlijk. */
export function firstSentence(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 8) return null;
  const m = t.match(/^(.{8,}?[.?!…])(\s|$)/u);
  const s = (m ? m[1] : t).trim();
  const chars = Array.from(s);
  return chars.length > 200 ? chars.slice(0, 197).join("").trimEnd() + "..." : s;
}

const HOOK_REASON: Record<string, string> = {
  Vraag: "Een vraag maakt nieuwsgierig naar het antwoord, waardoor kijkers blijven hangen.",
  Prijs: "Een concreet bedrag is direct herkenbaar en maakt het onderwerp tastbaar.",
  Getal: "Een concreet getal belooft iets meetbaars en wekt verwachting.",
  Nieuwsgierigheid: "De opening houdt iets achter, waardoor kijkers willen zien hoe het afloopt.",
  "Spreekt kijker aan": "De kijker wordt direct aangesproken en voelt zich persoonlijk bedoeld.",
  Rondleiding: "De opening belooft direct iets te laten zien; de kijker gaat mee naar binnen.",
  Stelling: "Een duidelijke stelling maakt in één zin helder waar de video over gaat.",
};

export function openingReason(text: string): string {
  const types = classifyHook(text);
  const t = types.find((x) => x !== "Stelling") ?? types[0] ?? "Stelling";
  return HOOK_REASON[t] ?? HOOK_REASON.Stelling;
}

const HOOK_LABEL: Record<string, string> = {
  Vraag: "Openen met een vraag",
  Prijs: "Een prijs in de opening",
  Getal: "Een getal in de opening",
  Nieuwsgierigheid: "Nieuwsgierigheid wekken",
  "Spreekt kijker aan": "De kijker direct aanspreken",
  Rondleiding: "Openen met een rondleiding",
  Stelling: "Openen met een stelling",
};

export const DIMENSION_LABEL: Record<GroupDimension, string> = {
  format: "Type video",
  hook: "Opening",
  lengte: "Videolengte",
  cta: "Afsluiter",
  opbouw: "Presentatievorm",
};

/* ------------------------------------------------------------------ *
 * Opbouw
 * ------------------------------------------------------------------ */

const r2 = (x: number) => Math.round(x * 100) / 100;

function groupKind(n: number, hits: number, medianPerf: number, best: YearVideo): GroupKind {
  if (n >= 3 && hits / n >= 0.6 && medianPerf >= ABOVE) return "patroon";
  if (n === 2 && hits === 2 && medianPerf >= ABOVE) return "signaal";
  if (n === 1 && (best.perf ?? 0) >= 2) return "uitschieter";
  return "geen";
}

export function buildYearView(input: {
  period: YearPeriod;
  /** Video's van de klant (zelfde bron als de Resultatenpagina). */
  videos: PortalVideo[];
  /** Contentgeheugen over dezelfde periode. */
  memory: ContentMemory;
  ai: Pick<MemoryAi, "formats" | "structures">;
  /** Eerste uitgesproken zin per publicatie-id, uit het videotranscript. */
  transcripts: Map<string, string>;
  /** Publicaties die een video zijn (foto's en carrousels tellen niet mee). Leeg = alles. */
  videoPublicationIds?: Set<string>;
  lastMeasured?: string | null;
}): YearView {
  const { period, memory, ai, transcripts } = input;
  const isVideo = (v: PortalVideo) => !input.videoPublicationIds || v.platforms.some((p) => input.videoPublicationIds!.has(p.publicationId));
  const inPeriod = input.videos.filter((v) => v.publishedAt >= period.from && v.publishedAt <= period.to && isVideo(v));
  const byPub = new Map<string, MemoryVideo>(memory.all.map((v) => [v.id, v]));

  const averageViews = Math.round(median(inPeriod.map((v) => v.views)) ?? 0);
  const averageInteractions = Math.round(median(inPeriod.map((v) => v.interactions)) ?? 0);

  const videos: YearVideo[] = inPeriod.map((v) => {
    const inst = v.platforms.map((p) => byPub.get(p.publicationId)).filter((x): x is MemoryVideo => !!x);
    const weight = inst.reduce((a, i) => a + Math.max(1, i.views), 0);
    const perf = inst.length ? r2(inst.reduce((a, i) => a + i.perf * Math.max(1, i.views), 0) / weight) : null;
    const lead = [...inst].sort((a, b) => b.views - a.views)[0];
    const transcript = v.platforms.map((p) => transcripts.get(p.publicationId)).find(Boolean);
    const scripted = inst.find((i) => i.hookSource === "gesproken" && i.hook);
    const opening: Opening | null = transcript ? { text: transcript, source: "transcript" } : scripted ? { text: scripted.hook, source: "script" } : null;
    const structure = inst.map((i) => ai.structures?.[i.id]).find((s) => s && s !== "Onbekend") ?? null;
    const duration = inst.map((i) => i.durationSeconds).find((d) => d && d > 0) ?? null;
    const vsAverage = averageViews > 0 ? r2(v.views / averageViews) : null;
    return {
      ...v,
      // Geen omslag via Frame of de post zelf: die van het Contentgeheugen (crosspost of bibliotheek).
      thumbUrl: v.thumbUrl ?? inst.map((i) => i.thumbnail).find(Boolean) ?? null,
      vsAverage,
      above: vsAverage != null && vsAverage >= ABOVE,
      perf,
      format: inst.map((i) => i.format).find(Boolean) ?? null,
      hookTypes: lead?.hookTypes ?? [],
      cta: lead?.cta ?? null,
      ctaText: lead?.ctaText ?? null,
      durationSeconds: duration,
      lengthLabel: lengthBucket(duration),
      structure,
      opening,
    };
  });

  const analyzed = videos.filter((v) => v.perf != null);
  const byViews = [...videos].sort((a, b) => b.views - a.views);

  const group = (dimension: GroupDimension, keysOf: (v: YearVideo) => string[]): YearGroup[] => {
    const map = new Map<string, YearVideo[]>();
    for (const v of analyzed) for (const k of keysOf(v)) map.set(k, [...(map.get(k) ?? []), v]);
    return [...map.entries()]
      .map(([label, vs]): YearGroup => {
        const sorted = [...vs].sort((a, b) => (b.perf ?? 0) - (a.perf ?? 0) || b.views - a.views);
        const hits = vs.filter((v) => (v.perf ?? 0) >= 1).length;
        const medianPerf = r2(median(vs.map((v) => v.perf ?? 0)) ?? 0);
        const medianViews = Math.round(median(vs.map((v) => v.views)) ?? 0);
        const best = sorted[0];
        return {
          dimension,
          label,
          n: vs.length,
          hits,
          medianPerf,
          medianViews,
          medianInteractions: Math.round(median(vs.map((v) => v.interactions)) ?? 0),
          vsAverage: averageViews > 0 ? r2(medianViews / averageViews) : null,
          kind: groupKind(vs.length, hits, medianPerf, best),
          videos: sorted,
          best,
        };
      })
      .sort((a, b) => b.medianPerf - a.medianPerf || b.n - a.n);
  };

  const formats = group("format", (v) => (v.format ? [v.format] : []));
  const hooks = group("hook", (v) => v.hookTypes.filter((t) => t !== "Stelling")).map((g) => ({ ...g, label: HOOK_LABEL[g.label] ?? g.label }));
  const lengths = group("lengte", (v) => (v.lengthLabel ? [v.lengthLabel] : []));
  const ctas = group("cta", (v) => (v.cta && v.cta !== "Geen duidelijke CTA" ? [v.cta] : []));
  const structures = group("opbouw", (v) => (v.structure ? [v.structure] : []));

  const sufficient = analyzed.length >= MIN_YEAR_VIDEOS;
  const all = [...formats, ...hooks, ...lengths, ...ctas, ...structures];
  const patterns = sufficient ? all.filter((g) => g.kind === "patroon").sort((a, b) => b.medianPerf - a.medianPerf).slice(0, 8) : [];
  const early = sufficient
    ? all.filter((g) => g.kind === "signaal" || g.kind === "uitschieter").sort((a, b) => b.medianPerf - a.medianPerf).filter((g, i, arr) => arr.findIndex((x) => x.best.key === g.best.key) === i).slice(0, 3)
    : [];

  // "Zo ziet jouw best presterende video eruit": alleen wat bij minstens twee video's werkte.
  const hero: HeroCard[] = [];
  if (sufficient) {
    const fmt = formats.find((g) => g.n >= 2 && g.medianPerf >= 1);
    if (fmt) {
      const info = ai.formats?.find((f) => f.name === fmt.label);
      hero.push({ key: "format", label: "Type video", value: fmt.label, video: fmt.best, n: fmt.n, kind: fmt.kind, why: info?.why || `${fmt.hits} van de ${fmt.n} video's van dit type scoorden boven je normale niveau.` });
    }
    const op = [...analyzed].filter((v) => v.opening && (v.perf ?? 0) >= 1).sort((a, b) => (b.perf ?? 0) - (a.perf ?? 0) || b.views - a.views)[0];
    if (op?.opening) {
      const same = hooks.find((g) => g.videos.some((v) => v.key === op.key));
      hero.push({ key: "opening", label: "Opening", value: op.opening.text, video: op, n: same?.n ?? 1, kind: same?.kind ?? "uitschieter", why: openingReason(op.opening.text) });
    }
    const len = lengths.find((g) => g.n >= 2 && g.medianPerf >= 1);
    if (len) hero.push({ key: "lengte", label: "Videolengte", value: len.label, video: len.best, n: len.n, kind: len.kind, why: `${len.hits} van de ${len.n} video's van deze lengte scoorden boven je normale niveau.` });
  }

  const platformMap = new Map<string, { platform: string; videos: number; views: number; interactions: number }>();
  for (const v of videos) for (const p of v.platforms) {
    const cur = platformMap.get(p.platform) ?? { platform: p.platform, videos: 0, views: 0, interactions: 0 };
    cur.videos++;
    cur.views += p.views;
    cur.interactions += p.likes + p.comments + p.shares + p.saves;
    platformMap.set(p.platform, cur);
  }

  return {
    period,
    videoCount: videos.length,
    analyzedCount: analyzed.length,
    tooYoung: videos.length - analyzed.length,
    totalViews: videos.reduce((a, v) => a + v.views, 0),
    totalInteractions: videos.reduce((a, v) => a + v.interactions, 0),
    platforms: [...platformMap.values()].sort((a, b) => b.views - a.views),
    averageViews,
    averageInteractions,
    sufficient,
    top: byViews.filter((v) => v.views > 0).slice(0, 15),
    hero,
    patterns,
    early,
    formats: formats.filter((g) => g.n >= 2 && g.medianPerf >= 1).slice(0, 8),
    openings: analyzed
      .filter((v) => v.opening && (v.perf ?? 0) >= 1)
      .sort((a, b) => (b.perf ?? 0) - (a.perf ?? 0) || b.views - a.views)
      .slice(0, 6),
    ctas: ctas.filter((g) => g.n >= 2 && g.medianPerf >= 1).slice(0, 3),
    lastMeasured: input.lastMeasured ?? null,
  };
}
