/**
 * Pure hulpfuncties voor de interne resultatenpagina (/analytics): periodes,
 * het samenvoegen van dezelfde video op meerdere platforms, rangschikken en de
 * afspeel-URL per platform. Geen database, zodat dit los te testen is.
 */

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
};

export type VideoCard = PostRow & {
  /** null = dit platform levert dit cijfer niet (toon "Niet beschikbaar"). */
  reachValue: number | null;
  savesValue: number | null;
  engagement: number;
  alsoOn: Platform[];
  embedUrl: string | null;
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

export function toCard(p: PostRow): VideoCard {
  return {
    ...p,
    reachValue: reachValue(p),
    savesValue: savesValue(p),
    engagement: p.likes + p.comments + p.shares + p.saves,
    alsoOn: [],
    embedUrl: embedUrl(p.platform, p.url),
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
