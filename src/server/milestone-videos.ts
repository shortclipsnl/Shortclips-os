import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cleanVideoTitle } from "@/lib/portal-status";
import { groupPublications, matchVideosToAssets, type ReelAsset, type ReelPublication } from "@/lib/screen-reel-match";
import { captionTitle } from "@/server/screen-reel";
import type { LibraryVideo, MilestoneVideo } from "@/lib/milestones";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const amsDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });

/** Ingesloten speler van de originele post (TikTok, Instagram, YouTube, Facebook). */
export function embedFor(platform: string, url: string | null): string | null {
  if (!url) return null;
  try {
    if (platform === "tiktok") {
      const id = url.match(/\/video\/(\d+)/)?.[1];
      return id ? `https://www.tiktok.com/player/v1/${id}?music_info=0&description=0&rel=0` : null;
    }
    if (platform === "instagram") {
      const code = url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([^/?#]+)/)?.[1];
      return code ? `https://www.instagram.com/p/${code}/embed/` : null;
    }
    if (platform === "youtube") {
      const id = url.match(/(?:shorts\/|youtu\.be\/|[?&]v=)([\w-]{6,})/)?.[1];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (platform === "facebook") {
      return `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url)}&show_text=false&width=500`;
    }
  } catch {
    /* onbekende link: geen speler */
  }
  return null;
}

/** Voorkeur voor de ingesloten speler: video-eerst platforms. */
const EMBED_ORDER = ["tiktok", "youtube", "instagram", "facebook"];

/**
 * De video's achter de mijlpalen, uit de bestaande bronnen:
 * - posts met cijfers (publications + laatste meting in social_metrics, zelfde
 *   bron als Resultaten), per video samengevoegd over platforms zodat niets
 *   dubbel telt;
 * - de opgeleverde video's uit de videobibliotheek (deliverables + frame_assets).
 * Posts die zeker bij een Frame-video horen (koppellogica van het kantoorscherm)
 * spelen af via Frame; de rest via de originele post. Alleen deze klant.
 */
export async function getMilestoneVideos(clientId: string): Promise<{ videos: MilestoneVideo[]; library: LibraryVideo[] }> {
  const [pubRes, libRes] = await Promise.all([
    db.execute(sql`
      with latest as (
        select distinct on (sm.publication_id)
          sm.publication_id, sm.views, sm.reach, sm.likes, sm.comments, sm.shares, sm.saves
        from social_metrics sm
        where sm.client_id = ${clientId}
        order by sm.publication_id, sm.measured_on desc
      )
      select p.id, p.platform::text platform, p.published_at, p.duration_seconds, p.caption,
             p.external_url, case when length(p.thumbnail_data) < 250000 then p.thumbnail_data end thumb,
             coalesce(l.views,0)::bigint views, coalesce(l.reach,0)::bigint reach,
             coalesce(l.likes,0)::bigint likes, coalesce(l.comments,0)::bigint comments,
             coalesce(l.shares,0)::bigint shares, coalesce(l.saves,0)::bigint saves
      from publications p
      left join latest l on l.publication_id = p.id
      where p.client_id = ${clientId} and p.deleted_at is null
        and p.status = 'published' and p.published_at is not null`),
    db.execute(sql`
      select distinct on (fa.id) fa.id, fa.name, fa.subfolder_name, fa.duration_seconds, fa.frame_created_at,
             d.title, d.published_at
      from deliverables d
      join frame_assets fa on fa.frame_file_id::text = d.frame_asset_id::text
        and fa.client_id = ${clientId} and fa.deleted_at is null
      where d.client_id = ${clientId} and d.deleted_at is null and d.status = 'published'
      order by fa.id, d.published_at desc nulls last`),
  ]);

  type PubRow = {
    id: string; platform: string; published_at: string | Date; duration_seconds: number | null; caption: string | null;
    external_url: string | null; thumb: string | null; views: number; reach: number; likes: number; comments: number; shares: number; saves: number;
  };
  const pubRows = rows<PubRow>(pubRes);
  const thumbByUrl = new Map<string, string>();
  for (const r of pubRows) if (r.external_url && r.thumb) thumbByUrl.set(r.external_url, r.thumb);

  const pubs: ReelPublication[] = pubRows.map((r) => ({
    id: r.id,
    clientId,
    platform: r.platform,
    publishedAt: new Date(r.published_at),
    durationSeconds: r.duration_seconds,
    caption: r.caption,
    externalUrl: r.external_url,
    views: Number(r.views),
    reach: Number(r.reach),
    likes: Number(r.likes),
    comments: Number(r.comments),
    shares: Number(r.shares),
    saves: Number(r.saves),
  }));

  type LibRow = { id: string; name: string; subfolder_name: string | null; duration_seconds: number | null; frame_created_at: string | Date | null; title: string | null; published_at: string | Date | null };
  const libRows = rows<LibRow>(libRes);
  const assets: ReelAsset[] = libRows.map((r) => ({
    id: r.id,
    clientId,
    name: r.name,
    subfolderName: r.subfolder_name,
    durationSeconds: r.duration_seconds,
    frameCreatedAt: r.frame_created_at ? new Date(r.frame_created_at) : null,
  }));

  const groups = groupPublications(pubs);
  const assetByKey = new Map(matchVideosToAssets(groups, assets).map((m) => [m.video.key, m.asset.id]));
  const keyByAsset = new Map([...assetByKey].map(([k, a]) => [a, k]));

  const videos: MilestoneVideo[] = groups
    .map((g) => {
      const assetId = assetByKey.get(g.key) ?? null;
      const thumb = g.platforms.map((p) => (p.url ? thumbByUrl.get(p.url) : undefined)).find(Boolean) ?? null;
      const embedPlat = [...g.platforms].sort((a, b) => EMBED_ORDER.indexOf(a.platform) - EMBED_ORDER.indexOf(b.platform)).find((p) => embedFor(p.platform, p.url));
      return {
        key: g.key,
        title: captionTitle(g.caption) || "Video",
        publishedAt: amsDay(g.publishedAt),
        platforms: g.platforms,
        views: g.views,
        likes: g.likes,
        comments: g.comments,
        shares: g.shares,
        saves: g.saves,
        interactions: g.likes + g.comments + g.shares + g.saves,
        thumbUrl: assetId ? `/api/portal/frame/${assetId}/thumb` : thumb,
        playSrc: assetId ? `/api/portal/frame/${assetId}/play` : null,
        embedSrc: embedPlat ? embedFor(embedPlat.platform, embedPlat.url) : null,
        externalUrl: g.platforms.find((p) => p.url)?.url ?? null,
      };
    })
    .sort((a, b) => b.views - a.views);

  const library: LibraryVideo[] = libRows
    .map((r) => ({
      id: r.id,
      title: cleanVideoTitle(r.title) || cleanVideoTitle(r.name) || "Video",
      publishedAt: r.published_at ? amsDay(new Date(r.published_at)) : null,
      durationSeconds: r.duration_seconds,
      statsKey: keyByAsset.get(r.id) ?? null,
    }))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  return { videos, library };
}
