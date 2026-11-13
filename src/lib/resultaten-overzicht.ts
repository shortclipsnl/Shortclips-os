/**
 * Pure hulpfuncties voor de interne resultatenpagina (/analytics): periodes,
 * het samenvoegen van dezelfde video op meerdere platforms, rangschikken en de
 * afspeel-URL per platform. Geen database, zodat dit los te testen is.
 */

import { compact } from "@/lib/format";

export type PeriodKey = "7" | "30" | "90" | "maand" | "vorigemaand";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7", label: "7 dagen" },
  { key: "30", label: "30 dagen" },
  { key: "90", label: "90 dagen" },
  { key: "maand", label: "Deze maand" },
  { key: "vorigemaand", label: "Vorige maand" },
];

export type Period = {
  key: PeriodKey;
  label: string;
  /** Inclusief, YYYY-MM-DD (Nederlandse kalenderdag). */
  from: string;
  /** Exclusief, YYYY-MM-DD. */
  to: string;
  prevFrom: string;
  prevTo: string;
  /** Leesbare omschrijving van de vergelijkingsperiode. */
  prevLabel: string;
  days: number;
};

export function parsePeriodKey(v: string | undefined | null): PeriodKey {
  return PERIODS.some((p) => p.key === v) ? (v as PeriodKey) : "30";
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const diffDays = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);

/** Vandaag als YYYY-MM-DD in Nederlandse tijd. */
export function amsterdamToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

/**
 * Venster [from, to) plus een even lange vergelijkingsperiode direct ervoor.
 * "Vorige maand" vergelijkt met de volledige kalendermaand daarvoor.
 */
export function resolvePeriod(key: PeriodKey, today: string): Period {
  const label = PERIODS.find((p) => p.key === key)!.label;
  const tomorrow = addDays(today, 1);
  if (key === "maand") {
    const from = `${today.slice(0, 7)}-01`;
    const len = diffDays(from, tomorrow);
    return { key, label, from, to: tomorrow, prevFrom: addDays(from, -len), prevTo: from, prevLabel: `vorige ${len} dagen`, days: len };
  }
  if (key === "vorigemaand") {
    const thisMonth = `${today.slice(0, 7)}-01`;
    const d = new Date(`${thisMonth}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const from = iso(d);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const prevFrom = iso(d);
    return { key, label, from, to: thisMonth, prevFrom, prevTo: from, prevLabel: "de maand ervoor", days: diffDays(from, thisMonth) };
  }
  const n = Number(key);
  // Zelfde definitie als voorheen: meetdagen vanaf vandaag − N (de meting van
  // vandaag komt meestal pas morgen binnen).
  const from = addDays(today, -n);
  return { key, label, from, to: tomorrow, prevFrom: addDays(from, -n), prevTo: from, prevLabel: `vorige ${n} dagen`, days: n };
}

/** Procentuele verandering; null als er geen eerlijke basis is. */
export function deltaPct(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export type Platform = "instagram" | "tiktok" | "facebook" | "youtube" | "linkedin";

export type PostRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogoUrl: string | null;
  platform: Platform;
  url: string | null;
  caption: string | null;
  publishedAt: string; // ISO
  durationSeconds: number | null;
  thumb: string | null;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** Gemiddelde kijktijd per weergave (sec); null = platform levert het niet. */
  avgWatchSeconds?: number | null;
  /** 0..1 zoals Metricool die levert; null = onbekend. */
  completionRate?: number | null;
  /** Openingszin van de caption (bij Shortclips vrijwel altijd de hook). */
  hook?: string | null;
};

export type VideoCard = PostRow & {
  /** null = dit platform levert dit cijfer niet (toon "Niet beschikbaar"). */
  reachValue: number | null;
  savesValue: number | null;
  engagement: number;
  alsoOn: Platform[];
  embedUrl: string | null;
  /** Interacties / weergaven (0..1); null onder MIN_VIEWS_FOR_RATE weergaven. */
  engagementRate: number | null;
  /** Deel van de video dat gemiddeld bekeken wordt (0..1); null = onbekend. */
  retention: number | null;
  /** Weergaven t.o.v. het normale niveau van die klant op dat platform; null = geen basis. */
  hookScore: number | null;
  /** 0..100: weergaven, engagement en retentie samen, binnen de gekozen periode. */
  totalScore: number | null;
  /** Frame.io-bestand van deze video, als die zeker gekoppeld is (eigen speler). */
  assetId: string | null;
  /** Post-URL's van deze video op alle platforms (crossposts samen). */
  allUrls: string[];
};

/** Is deze post een video (reel/short) en geen foto of tekstpost? */
export function isVideoPost(p: Pick<PostRow, "platform" | "url" | "durationSeconds">): boolean {
  if ((p.durationSeconds ?? 0) > 0) return true;
  const u = p.url ?? "";
  if (p.platform === "tiktok") return /\/video\//.test(u);
  return /\/reels?\/|\/videos?\//.test(u);
}

/**
 * Welke cijfers een platform per video levert. Facebook geeft geen bereik of
 * opslagen per post door, TikTok geen opslagen en niet altijd bereik. Een 0
 * daar is dus "onbekend", niet "nul".
 */
export function reachValue(p: Pick<PostRow, "platform" | "reach">): number | null {
  if (p.platform === "facebook") return null;
  if (p.platform === "tiktok" && p.reach <= 0) return null;
  return p.reach;
}
export function savesValue(p: Pick<PostRow, "platform" | "saves">): number | null {
  return p.platform === "instagram" ? p.saves : null;
}

/** Afspeel-URL binnen het portaal (officiële embed-spelers van de platforms). */
export function embedUrl(platform: Platform, url: string | null): string | null {
  if (!url) return null;
  if (platform === "instagram") {
    const m = url.match(/instagram\.com\/(?:[^/]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const kind = m[1] === "reels" ? "reel" : m[1];
    return `https://www.instagram.com/${kind}/${m[2]}/embed/`;
  }
  if (platform === "tiktok") {
    const m = url.match(/\/video\/(\d+)/);
    return m ? `https://www.tiktok.com/player/v1/${m[1]}?autoplay=1&rel=0&description=0` : null;
  }
  if (platform === "facebook") {
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=true`;
  }
  return null;
}

/** Sleutel om dezelfde video op Instagram én Facebook (crosspost) te herkennen. */
export function crosspostKey(p: Pick<PostRow, "id" | "clientId" | "publishedAt" | "caption">): string {
  const day = new Date(p.publishedAt).toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const cap = (p.caption ?? "").toLowerCase().replace(/\s+/g, "").slice(0, 50);
  // Zonder caption kunnen we niet zeker zijn dat het dezelfde video is.
  if (!cap) return `${p.clientId}|${day}|post:${p.id}`;
  return `${p.clientId}|${day}|${cap}`;
}

export type SortKey = "views" | "reach" | "engagement";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "views", label: "Weergaven" },
  { key: "reach", label: "Bereik" },
  { key: "engagement", label: "Betrokkenheid" },
];

/** Onder dit aantal weergaven zegt een percentage (engagement) te weinig. */
export const MIN_VIEWS_FOR_RATE = 500;
/** Minimum weergaven om een hook als "sterk" te kunnen aanwijzen. */
export const MIN_VIEWS_FOR_HOOK = 300;

/** Retentie: gem. kijktijd / lengte als beide bekend zijn, anders wat het platform levert. */
export function retentionOf(p: Pick<PostRow, "avgWatchSeconds" | "durationSeconds" | "completionRate">): number | null {
  const avg = p.avgWatchSeconds ?? 0;
  const dur = p.durationSeconds ?? 0;
  if (avg > 0 && dur > 0) return Math.min(1, avg / dur);
  if (p.completionRate != null && p.completionRate > 0) return Math.min(1, p.completionRate);
  return null;
}

export function toCard(p: PostRow): VideoCard {
  const engagement = p.likes + p.comments + p.shares + p.saves;
  return {
    ...p,
    avgWatchSeconds: p.avgWatchSeconds != null && p.avgWatchSeconds > 0 ? p.avgWatchSeconds : null,
    reachValue: reachValue(p),
    savesValue: savesValue(p),
    engagement,
    alsoOn: [],
    embedUrl: embedUrl(p.platform, p.url),
    engagementRate: p.views >= MIN_VIEWS_FOR_RATE ? engagement / p.views : null,
    retention: retentionOf(p),
    hookScore: null,
    totalScore: null,
    assetId: null,
    allUrls: p.url ? [p.url] : [],
  };
}

/**
 * Alleen video's, crossposts samengevoegd (de best presterende versie telt, de
 * andere platforms staan als "ook op"), zodat dezelfde video niet twee keer in
 * de top staat.
 */
export function videoCards(posts: PostRow[]): VideoCard[] {
  const groups = new Map<string, VideoCard[]>();
  for (const p of posts) {
    if (!isVideoPost(p)) continue;
    const k = crosspostKey(p);
    const list = groups.get(k) ?? [];
    list.push(toCard(p));
    groups.set(k, list);
  }
  const out: VideoCard[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.views - a.views);
    const [best, ...rest] = list;
    if (!best) continue;
    best.alsoOn = [...new Set(rest.map((r) => r.platform).filter((pl) => pl !== best.platform))];
    best.allUrls = list.flatMap((x) => (x.url ? [x.url] : []));
    out.push(best);
  }
  return out;
}

export function rankVideos(cards: VideoCard[], sort: SortKey, limit = 10): VideoCard[] {
  const val = (c: VideoCard) => (sort === "views" ? c.views : sort === "reach" ? c.reachValue ?? -1 : c.engagement);
  return [...cards]
    .filter((c) => (sort === "reach" ? c.reachValue !== null : true))
    .sort((a, b) => val(b) - val(a) || b.views - a.views)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Categorieën voor "Best presterende video's" en de presentatiemodus.
 * Elke categorie gebruikt alleen video's waarvoor het cijfer echt bestaat.
 * ------------------------------------------------------------------ */

export type TopCategory = "totaal" | "weergaven" | "kijktijd" | "retentie" | "hooks" | "interacties" | "engagement";

export const TOP_CATEGORIES: { key: TopCategory; label: string; explain: string }[] = [
  { key: "totaal", label: "Totale prestaties", explain: "Score van 0 tot 100 op weergaven, engagement en retentie samen, vergeleken met alle video's uit deze periode." },
  { key: "weergaven", label: "Meeste weergaven", explain: "Weergaven volgens de laatste meting." },
  { key: "kijktijd", label: "Hoogste kijktijd", explain: "Gemiddelde kijktijd per weergave. Alleen video's waarvoor het platform kijktijd levert." },
  { key: "retentie", label: "Hoogste retentie", explain: "Welk deel van de video kijkers gemiddeld zien. Alleen video's waarvoor het platform dit levert." },
  { key: "hooks", label: "Beste hooks", explain: "Weergaven ten opzichte van wat normaal is voor die klant op dat platform (laatste 120 dagen). Hoe sterker de opening, hoe verder het algoritme de video verspreidt." },
  { key: "interacties", label: "Meeste interacties", explain: "Likes, reacties, keren gedeeld en opgeslagen samen." },
  { key: "engagement", label: "Beste engagement", explain: `Interacties gedeeld door weergaven, vanaf ${MIN_VIEWS_FOR_RATE} weergaven.` },
];

export function parseCategory(v: string | null | undefined): TopCategory {
  return TOP_CATEGORIES.some((c) => c.key === v) ? (v as TopCategory) : "totaal";
}

/** Sleutel voor de normale weergaven van een klant op een platform. */
export const baselineKey = (clientId: string, platform: string) => `${clientId}|${platform}`;

/** Percentielpositie (0..1) van x binnen een gesorteerde lijst. */
function pctRank(sorted: number[], x: number): number {
  if (sorted.length <= 1) return 0.5;
  let lo = 0;
  let eq = 0;
  for (const v of sorted) {
    if (v < x) lo++;
    else if (v === x) eq++;
  }
  return (lo + Math.max(0, eq - 1) / 2) / (sorted.length - 1);
}

/**
 * Vult hookScore en totalScore in. De totaalscore weegt weergaven (40%),
 * engagement (30%) en retentie (30%); ontbreekt een cijfer, dan tellen de
 * andere naar verhouding mee. Er wordt niets geschat.
 */
export function scoreCards(cards: VideoCard[], baselines: Map<string, number>): VideoCard[] {
  const asc = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const views = asc(cards.map((c) => c.views));
  const rates = asc(cards.flatMap((c) => (c.engagementRate == null ? [] : [c.engagementRate])));
  const rets = asc(cards.flatMap((c) => (c.retention == null ? [] : [c.retention])));
  return cards.map((c) => {
    const parts: [number, number][] = [[pctRank(views, c.views), 0.4]];
    if (c.engagementRate != null && rates.length >= 3) parts.push([pctRank(rates, c.engagementRate), 0.3]);
    if (c.retention != null && rets.length >= 3) parts.push([pctRank(rets, c.retention), 0.3]);
    const w = parts.reduce((s, [, x]) => s + x, 0);
    const totalScore = cards.length >= 3 ? Math.round((100 * parts.reduce((s, [v, x]) => s + v * x, 0)) / w) : null;
    const base = baselines.get(baselineKey(c.clientId, c.platform));
    const hookScore = c.hook && base && base > 0 && c.views >= MIN_VIEWS_FOR_HOOK ? Math.round((c.views / base) * 100) / 100 : null;
    return { ...c, totalScore, hookScore };
  });
}

/** De waarde waarop een categorie rangschikt; null = niet beschikbaar voor deze video. */
export function categoryValue(c: VideoCard, cat: TopCategory): number | null {
  switch (cat) {
    case "totaal": return c.totalScore;
    case "weergaven": return c.views;
    case "kijktijd": return c.avgWatchSeconds ?? null;
    case "retentie": return c.retention;
    case "hooks": return c.hookScore;
    case "interacties": return c.engagement;
    case "engagement": return c.engagementRate;
  }
}

export function rankByCategory(cards: VideoCard[], cat: TopCategory, limit = 10): VideoCard[] {
  return cards
    .flatMap((c) => {
      const v = categoryValue(c, cat);
      return v == null || (cat !== "weergaven" && cat !== "interacties" && v <= 0) ? [] : [{ c, v }];
    })
    .sort((a, b) => b.v - a.v || b.c.views - a.c.views)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Leesbare waarde van de categorie, voor het grote getal op een kaart of slide. */
export function formatCategoryValue(c: VideoCard, cat: TopCategory): { value: string; unit: string } | null {
  const v = categoryValue(c, cat);
  if (v == null) return null;
  const nl = (n: number, d = 0) => n.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
  switch (cat) {
    case "totaal": return { value: String(v), unit: "score" };
    case "weergaven": return { value: compact(v), unit: "weergaven" };
    case "kijktijd": return { value: `${nl(v, v < 10 ? 1 : 0)} sec`, unit: "gem. kijktijd" };
    case "retentie": return { value: `${nl(v * 100)}%`, unit: "retentie" };
    case "hooks": return { value: `${nl(v, 1)}×`, unit: "normaal bereik" };
    case "interacties": return { value: compact(v), unit: "interacties" };
    case "engagement": return { value: `${nl(v * 100, 1)}%`, unit: "engagement" };
  }
}
