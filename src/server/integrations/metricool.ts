import "server-only";
import { env } from "@/lib/env";
import { apiFetch } from "./http";

/**
 * Metricool — v2 API.
 *
 * Eén user-token (header `X-Mc-Auth`) geeft toegang tot alle merken van het
 * account. De user-id en merk-id's (blogId) halen we uit /settings/brands.
 * Statistieken komen uit /analytics/timelines als dagreeksen per metric.
 */
const BASE = "https://app.metricool.com/api/v2";

export type MetricoolBrand = { id: number; label: string; userId: number };
export type DailyPoint = { date: string; value: number };

/** Eén gepubliceerde post/reel met zijn eigen cijfers (per-video). */
export type MetricoolPost = {
  externalId: string;
  url: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null; // ISO-achtig, naïef (zoals Metricool levert)
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avgWatchSeconds: number | null;
  watchTimeSeconds: number;
  durationSeconds: number | null;
  /** 0..1, afgeleid uit gem. kijktijd / duur wanneer beide bekend zijn. */
  completionRate: number | null;
};

/** De netwerken die we meenemen in de gecombineerde cijfers. Niet-gekoppelde
 *  netwerken of niet-beschikbare metrics leveren een lege reeks op (de sync
 *  slaat die vanzelf over), dus dit uitbreiden is veilig. */
export const METRICOOL_NETWORKS = ["Instagram", "Tiktok", "Facebook", "Youtube", "Linkedin"] as const;

export class MetricoolService {
  constructor(private token = env.METRICOOL_USER_TOKEN) {}

  get isConfigured(): boolean {
    return Boolean(this.token);
  }

  private get headers(): Record<string, string> {
    return { "X-Mc-Auth": this.token ?? "", Accept: "application/json" };
  }

  /** Alle merken van het account (merk-id + label + user-id). */
  async listBrands(): Promise<MetricoolBrand[]> {
    const res = await apiFetch<{ data?: Array<{ id: number; label: string; userId: number }> }>(
      "metricool",
      `${BASE}/settings/brands`,
      { headers: this.headers },
    );
    return (res.data ?? [])
      .filter((b) => b.id && b.label && b.label !== "undefined")
      .map((b) => ({ id: b.id, label: b.label, userId: b.userId }));
  }

  /**
   * Dagwaarden van één metric voor een merk op één netwerk/subject (account,
   * reels, posts…). Geeft een lege reeks terug wanneer het netwerk/metric voor
   * dit merk niet beschikbaar is — zodat één netwerk de rest niet blokkeert.
   */
  async timeline(
    blogId: number,
    userId: number,
    network: string,
    subject: string,
    metric: string,
    fromISO: string,
    toISO: string,
  ): Promise<DailyPoint[]> {
    try {
      const res = await apiFetch<{ data?: Array<{ values?: Array<{ dateTime: string; value: number }> }> }>(
        "metricool",
        `${BASE}/analytics/timelines`,
        {
          headers: this.headers,
          retries: 0,
          query: { from: fromISO, to: toISO, network, subject, metric, blogId, userId },
        },
      );
      const values = res.data?.[0]?.values ?? [];
      return values.map((v) => ({ date: String(v.dateTime).slice(0, 10), value: Number(v.value) || 0 }));
    } catch {
      return [];
    }
  }

  /**
   * Per-post/per-reel cijfers voor één merk op één netwerk. `subject` is bv.
   * "reels" of "posts"; het netwerk gaat in kleine letters in het pad
   * (/analytics/<subject>/<network>). Geeft een lege lijst wanneer het netwerk
   * niet gekoppeld is (403) of er niets is — zodat één netwerk de rest niet
   * blokkeert.
   */
  async posts(
    blogId: number,
    userId: number,
    network: string,
    subject: string,
    fromISO: string,
    toISO: string,
  ): Promise<MetricoolPost[]> {
    try {
      const res = await apiFetch<{ data?: Array<Record<string, unknown>> }>(
        "metricool",
        `${BASE}/analytics/${subject}/${network.toLowerCase()}`,
        { headers: this.headers, retries: 0, query: { from: fromISO, to: toISO, blogId, userId } },
      );
      const rows = res.data ?? [];
      return rows.map((r) => normalizePost(r)).filter((p): p is MetricoolPost => p !== null);
    } catch {
      return [];
    }
  }
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const firstNum = (...vals: unknown[]): number => {
  for (const v of vals) if (v !== null && v !== undefined && Number.isFinite(Number(v))) return Number(v);
  return 0;
};
const firstStr = (...vals: unknown[]): string | null => {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v;
  return null;
};

/** Metricool-post/reel (meerdere vormen) → genormaliseerde MetricoolPost. */
function normalizePost(r: Record<string, unknown>): MetricoolPost | null {
  // Veldnamen verschillen per netwerk: Instagram (reels/posts), TikTok
  // (videoId, viewCount, ...) en Facebook-reels (reelId, blueReelsPlayCount, ...).
  const externalId = firstStr(r.reelId, r.videoId, r.contentId, r.postId, r.id, r.mediaId);
  if (!externalId) return null;
  const pub = (r.publishedAt ?? r.created ?? r.createTime) as { dateTime?: string } | string | undefined;
  const publishedAt = typeof pub === "string" ? pub : (pub?.dateTime ?? null);
  const duration = firstNum(r.durationSeconds, r.duration, r.length) || null;
  const avgWatchRaw = r.averageWatchTime ?? r.averageTimeWatched ?? r.postVideoAvgTimeWatchedSeconds;
  const avgWatch = avgWatchRaw != null ? num(avgWatchRaw) : null;
  let completion: number | null = null;
  if (r.fullVideoWatchedRate != null) completion = Math.max(0, Math.min(1, num(r.fullVideoWatchedRate)));
  else if (avgWatch != null && duration && duration > 0) completion = Math.min(1, avgWatch / duration);
  else if (r.reelsSkipRate != null) completion = Math.max(0, Math.min(1, 1 - num(r.reelsSkipRate) / 100));
  return {
    externalId,
    url: firstStr(r.url, r.postUrl, r.link, r.shareUrl, r.reelUrl),
    caption: firstStr(r.content, r.text, r.caption, r.title, r.videoDescription, r.description),
    thumbnailUrl: firstStr(r.imageUrl, r.thumbnailUrl, r.coverImageUrl, r.picture, r.image),
    publishedAt,
    views: firstNum(r.views, r.viewCount, r.blueReelsPlayCount, r.impressionsTotal, r.impressions, r.videoViews),
    reach: firstNum(r.reach),
    likes: firstNum(r.likes, r.likeCount, r.postVideoReactions),
    comments: firstNum(r.comments, r.commentCount),
    shares: firstNum(r.shares, r.shareCount),
    saves: firstNum(r.saved, r.saves, r.saveCount),
    avgWatchSeconds: avgWatch,
    watchTimeSeconds: firstNum(r.videoViewTotalTime, r.watchTime, r.totalTimeWatched, r.postVideoViewTimeSeconds),
    durationSeconds: duration,
    completionRate: completion,
  };
}

export const metricool = new MetricoolService();

/** ISO-datumtijd zoals Metricool die eist: yyyy-MM-ddTHH:mm:ss (geen zone). */
export function metricoolDate(d: Date, endOfDay = false): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const t = endOfDay ? "23:59:59" : "00:00:00";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${t}`;
}
