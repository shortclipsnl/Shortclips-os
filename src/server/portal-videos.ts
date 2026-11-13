import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { groupPublications, matchVideosToAssets, type ReelAsset, type ReelPublication } from "@/lib/screen-reel-match";
import { embedFor } from "@/server/milestone-videos";
import { captionTitle } from "@/server/screen-reel";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const amsDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });

/** De cijfers van één video op één platform. */
export type PortalVideoPlatform = {
  platform: string;
  publicationId: string;
  url: string | null;
  embedSrc: string | null;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avgWatchSeconds: number | null;
};

/**
 * Eén video, samengevoegd over alle platforms waarop hij geplaatst is. De
 * totalen zijn de som van de platforms: elke weergave is een echte, aparte
 * weergave, maar de video zelf komt maar één keer in de lijst.
 */
export type PortalVideo = {
  key: string;
  title: string;
  /** YYYY-MM-DD (Amsterdamse datum van de eerste plaatsing). */
  publishedAt: string;
  platforms: PortalVideoPlatform[];
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** likes + reacties + shares + opgeslagen */
  interactions: number;
  avgWatchSeconds: number | null;
  thumbUrl: string | null;
  /** Afspelen via Frame (in het portaal), alleen als de video zeker gekoppeld is. */
  playSrc: string | null;
  /** Anders: de originele post als ingesloten speler. */
  embedSrc: string | null;
  externalUrl: string | null;
};

const EMBED_ORDER = ["tiktok", "youtube", "instagram", "facebook"];

/**
 * Alle gepubliceerde video's van een klant met de laatste meting per post
 * (Metricool → social_metrics), per video samengevoegd over de platforms zodat
 * niets dubbel in de lijst staat. Video's die zeker bij een Frame-bestand horen
 * spelen af in het portaal; de rest via de originele post. Alleen deze klant.
 */
export async function getPublishedVideoResults(clientId: string): Promise<PortalVideo[]> {
  const [pubRes, assetRes] = await Promise.all([
    db.execute(sql`
      with latest as (
        select distinct on (sm.publication_id)
          sm.publication_id, sm.views, sm.reach, sm.likes, sm.comments, sm.shares, sm.saves, sm.avg_watch_seconds
        from social_metrics sm
        where sm.client_id = ${clientId}
        order by sm.publication_id, sm.measured_on desc
      )
      select p.id, p.platform::text platform, p.published_at, p.duration_seconds, p.caption, p.external_url,
             (p.thumbnail_data is not null) has_thumb,
             coalesce(l.views,0)::bigint views, coalesce(l.reach,0)::bigint reach,
             coalesce(l.likes,0)::bigint likes, coalesce(l.comments,0)::bigint comments,
             coalesce(l.shares,0)::bigint shares, coalesce(l.saves,0)::bigint saves,
             l.avg_watch_seconds aws, (l.publication_id is not null) measured
      from publications p
      left join latest l on l.publication_id = p.id
      where p.client_id = ${clientId} and p.deleted_at is null
        and p.status = 'published' and p.published_at is not null`),
    db.execute(sql`
      select distinct on (fa.id) fa.id, fa.name, fa.subfolder_name, fa.duration_seconds, fa.frame_created_at
      from deliverables d
      join frame_assets fa on fa.frame_file_id::text = d.frame_asset_id::text
        and fa.client_id = ${clientId} and fa.deleted_at is null
      where d.client_id = ${clientId} and d.deleted_at is null and d.status = 'published'
      order by fa.id`),
  ]);

  type PubRow = {
    id: string; platform: string; published_at: string | Date; duration_seconds: number | null; caption: string | null;
    external_url: string | null; has_thumb: boolean; views: number; reach: number; likes: number; comments: number;
    shares: number; saves: number; aws: string | number | null; measured: boolean;
  };
  const pubRows = rows<PubRow>(pubRes);
  const thumbPub = new Map<string, string>();
  for (const r of pubRows) if (r.has_thumb) thumbPub.set(r.id, r.id);

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
    avgWatchSeconds: r.aws != null && Number(r.aws) > 0 ? Math.round(Number(r.aws)) : null,
  }));

  type AssetRow = { id: string; name: string; subfolder_name: string | null; duration_seconds: number | null; frame_created_at: string | Date | null };
  const assets: ReelAsset[] = rows<AssetRow>(assetRes).map((r) => ({
    id: r.id,
    clientId,
    name: r.name,
    subfolderName: r.subfolder_name,
    durationSeconds: r.duration_seconds,
    frameCreatedAt: r.frame_created_at ? new Date(r.frame_created_at) : null,
  }));

  const groups = groupPublications(pubs);
  const assetByKey = new Map(matchVideosToAssets(groups, assets).map((m) => [m.video.key, m.asset.id]));

  return groups
    .map((g): PortalVideo => {
      const assetId = assetByKey.get(g.key) ?? null;
      const platforms: PortalVideoPlatform[] = g.platforms.map((p) => ({
        platform: p.platform,
        publicationId: p.publicationId ?? g.key,
        url: p.url,
        embedSrc: embedFor(p.platform, p.url),
        views: p.views,
        reach: p.reach ?? 0,
        likes: p.likes ?? 0,
        comments: p.comments ?? 0,
        shares: p.shares ?? 0,
        saves: p.saves ?? 0,
        avgWatchSeconds: p.avgWatchSeconds ?? null,
      }));
      const postThumb = platforms.map((p) => thumbPub.get(p.publicationId)).find(Boolean);
      const embedPlat = [...platforms].sort((a, b) => EMBED_ORDER.indexOf(a.platform) - EMBED_ORDER.indexOf(b.platform)).find((p) => p.embedSrc);
      // Gemiddelde kijktijd gewogen naar weergaven, alleen over platforms die hem leveren.
      const withWatch = platforms.filter((p) => p.avgWatchSeconds && p.views > 0);
      const watchViews = withWatch.reduce((s, p) => s + p.views, 0);
      const avgWatchSeconds = watchViews > 0 ? Math.round(withWatch.reduce((s, p) => s + p.avgWatchSeconds! * p.views, 0) / watchViews) : null;
      return {
        key: g.key,
        title: captionTitle(g.caption) || "Video",
        publishedAt: amsDay(g.publishedAt),
        platforms,
        views: g.views,
        reach: g.reach,
        likes: g.likes,
        comments: g.comments,
        shares: g.shares,
        saves: g.saves,
        interactions: g.likes + g.comments + g.shares + g.saves,
        avgWatchSeconds,
        thumbUrl: assetId ? `/api/portal/frame/${assetId}/thumb` : postThumb ? `/api/portal/post-thumb/${postThumb}` : null,
        playSrc: assetId ? `/api/portal/frame/${assetId}/play` : null,
        embedSrc: embedPlat?.embedSrc ?? null,
        externalUrl: platforms.find((p) => p.url)?.url ?? null,
      };
    })
    .sort((a, b) => b.views - a.views);
}
