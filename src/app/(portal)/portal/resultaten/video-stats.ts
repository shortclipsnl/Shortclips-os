import type { PortalVideo } from "@/server/portal";
import { PLATFORM } from "@/lib/statuses";
import type { Playable } from "../mijlpalen/video-parts";

/** "alle" of een platformsleutel (instagram, tiktok, youtube, facebook). */
export type PlatformFilterValue = string;

export type VideoStats = {
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  interactions: number;
  /** Interacties als percentage van de weergaven (1 decimaal), of null zonder weergaven. */
  rate: number | null;
  avgWatchSeconds: number | null;
  url: string | null;
};

export const platLabel = (p: string) => PLATFORM[p]?.label ?? p.charAt(0).toUpperCase() + p.slice(1);
export const platColor = (p: string) => PLATFORM[p]?.color ?? "#888";

/** De cijfers van een video: opgeteld over alle platforms, of alleen van het gekozen platform. */
export function statsFor(v: PortalVideo, platform: PlatformFilterValue): VideoStats {
  if (platform !== "alle") {
    const p = v.platforms.find((x) => x.platform === platform);
    if (p) {
      const interactions = p.likes + p.comments + p.shares + p.saves;
      return {
        views: p.views,
        reach: p.reach,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        saves: p.saves,
        interactions,
        rate: p.views > 0 ? Math.round((interactions / p.views) * 1000) / 10 : null,
        avgWatchSeconds: p.avgWatchSeconds,
        url: p.url,
      };
    }
  }
  return {
    views: v.views,
    reach: v.reach,
    likes: v.likes,
    comments: v.comments,
    shares: v.shares,
    saves: v.saves,
    interactions: v.interactions,
    rate: v.views > 0 ? Math.round((v.interactions / v.views) * 1000) / 10 : null,
    avgWatchSeconds: v.avgWatchSeconds,
    url: v.externalUrl,
  };
}

/** Video's voor het gekozen platform, gesorteerd op weergaven op dat platform. */
export function videosFor(videos: PortalVideo[], platform: PlatformFilterValue): PortalVideo[] {
  const list = platform === "alle" ? videos : videos.filter((v) => v.platforms.some((p) => p.platform === platform));
  return [...list].sort((a, b) => statsFor(b, platform).views - statsFor(a, platform).views);
}

/** Wat de speler nodig heeft. Bij een platformfilter speelt de post van dat platform als er geen Frame-video is. */
export function playableFor(v: PortalVideo, platform: PlatformFilterValue): Playable {
  const p = platform !== "alle" ? v.platforms.find((x) => x.platform === platform) : undefined;
  return {
    title: v.title,
    playSrc: v.playSrc,
    embedSrc: p?.embedSrc ?? v.embedSrc,
    externalUrl: p?.url ?? v.externalUrl,
    poster: v.thumbUrl,
    publishedAt: v.publishedAt,
    stats: v,
  };
}

const nf = new Intl.NumberFormat("nl-NL");
export const fmt = (n: number) => nf.format(n);
export const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
