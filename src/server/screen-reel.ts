import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { hasClientAccess, type Viewer } from "@/server/auth/context";
import {
  groupPublications,
  matchVideosToAssets,
  pickReel,
  type ReelAsset,
  type ReelPublication,
} from "@/lib/screen-reel-match";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

export type ScreenReelItem = {
  key: string;
  /** frame_assets.id: afspelen en omslag via de bestaande Frame-routes. */
  assetId: string;
  playSrc: string;
  posterSrc: string;
  clientId: string;
  clientName: string;
  title: string;
  publishedAt: string;
  durationSeconds: number | null;
  platforms: { platform: string; views: number }[];
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reason: "nieuw" | "top" | "uitschieter";
  relative: number;
};

export type ScreenReel = {
  items: ScreenReelItem[];
  /** Laatste dag waarop Metricool-cijfers binnenkwamen. */
  metricsDate: string | null;
  generatedAt: string;
};

/** Eerste zin van de caption, zonder hashtags, links en adresregels. */
export function captionTitle(caption: string): string {
  const firstLine =
    caption
      .split(/\n+/)
      .map((l) => l.trim())
      .find((l) => l.replace(/[#@][\w-]+|https?:\S+|www\.\S+|[^\p{L}\p{N}]/gu, "").length > 3) ?? "";
  const t = firstLine
    .replace(/https?:\S+|www\.\S+/g, "")
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t.length > 120 ? `${t.slice(0, 117).trimEnd()}…` : t;
}

// Kort in het geheugen bewaren: de cijfers wijzigen hooguit enkele keren per dag
// en zo blijft het scherm licht, ook als meerdere schermen tegelijk draaien.
let cache: { at: number; data: ScreenReel; assetByUrl: Map<string, string> } | null = null;
const CACHE_MS = 5 * 60_000;

async function buildReel(): Promise<{ reel: ScreenReel; assetByUrl: Map<string, string> }> {
  const [pubRes, assetRes, latestRes] = await Promise.all([
    db.execute(sql`
      with recent as (
        select p.id from publications p
        where p.deleted_at is null and p.status = 'published' and p.published_at >= now() - interval '120 days'
      ),
      pm as (
        select publication_id, max(views) views, max(reach) reach, max(likes) likes,
               max(comments) comments, max(shares) shares, max(saves) saves
        from social_metrics where publication_id in (select id from recent)
        group by publication_id
      )
      select p.id, p.client_id, c.name client_name, p.platform::text platform, p.published_at,
             p.duration_seconds, p.caption, p.external_url,
             coalesce(pm.views,0)::bigint views, coalesce(pm.reach,0)::bigint reach,
             coalesce(pm.likes,0)::bigint likes, coalesce(pm.comments,0)::bigint comments,
             coalesce(pm.shares,0)::bigint shares, coalesce(pm.saves,0)::bigint saves
      from publications p
      join clients c on c.id = p.client_id and c.deleted_at is null
        and c.status = 'active' and c.show_in_results = true
      left join pm on pm.publication_id = p.id
      where p.id in (select id from recent)`),
    db.execute(sql`
      select fa.id, fa.client_id, fa.name, fa.subfolder_name, fa.duration_seconds, fa.frame_created_at
      from frame_assets fa
      join clients c on c.id = fa.client_id and c.deleted_at is null and c.status = 'active'
      where fa.deleted_at is null and fa.frame_created_at >= now() - interval '300 days'`),
    db.execute(sql`select max(measured_on)::text d from social_metrics`),
  ]);

  type PubRow = {
    id: string; client_id: string; client_name: string; platform: string; published_at: string | Date;
    duration_seconds: number | null; caption: string | null; external_url: string | null;
    views: number; reach: number; likes: number; comments: number; shares: number; saves: number;
  };
  const pubRows = rows<PubRow>(pubRes);
  const clientNames = new Map(pubRows.map((r) => [r.client_id, r.client_name]));

  const pubs: ReelPublication[] = pubRows
    .filter((r) => r.published_at)
    .map((r) => ({
      id: r.id,
      clientId: r.client_id,
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

  const assets: ReelAsset[] = rows<{
    id: string; client_id: string; name: string; subfolder_name: string | null;
    duration_seconds: number | null; frame_created_at: string | Date | null;
  }>(assetRes).map((r) => ({
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    subfolderName: r.subfolder_name,
    durationSeconds: r.duration_seconds,
    frameCreatedAt: r.frame_created_at ? new Date(r.frame_created_at) : null,
  }));

  const matches = matchVideosToAssets(groupPublications(pubs), assets);
  // Zeker gekoppelde video's per post-URL: zo kan de resultatenpagina de echte
  // Frame-video afspelen in plaats van de (vaak geblokkeerde) platformspeler.
  const assetByUrl = new Map<string, string>();
  for (const m of matches) for (const pl of m.video.platforms) if (pl.url) assetByUrl.set(pl.url, m.asset.id);
  const picks = pickReel(matches, { perClient: 4, max: 36 });

  const items: ScreenReelItem[] = picks.map((p) => ({
    key: p.video.key,
    assetId: p.asset.id,
    playSrc: `/api/portal/frame/${p.asset.id}/play`,
    posterSrc: `/api/portal/frame/${p.asset.id}/thumb`,
    clientId: p.video.clientId,
    clientName: clientNames.get(p.video.clientId) ?? "",
    title: captionTitle(p.video.caption),
    publishedAt: p.video.publishedAt.toISOString(),
    durationSeconds: p.asset.durationSeconds ?? p.video.durationSeconds,
    platforms: p.video.platforms.map((x) => ({ platform: x.platform, views: x.views })),
    views: p.video.views,
    reach: p.video.reach,
    likes: p.video.likes,
    comments: p.video.comments,
    shares: p.video.shares,
    saves: p.video.saves,
    reason: p.reason,
    relative: p.relative,
  }));

  return {
    reel: {
      items,
      metricsDate: rows<{ d: string | null }>(latestRes)[0]?.d ?? null,
      generatedAt: new Date().toISOString(),
    },
    assetByUrl,
  };
}

async function cached() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const built = await buildReel();
    cache = { at: Date.now(), data: built.reel, assetByUrl: built.assetByUrl };
  }
  return cache;
}

/** Frame-bestand per post-URL (alleen zekere koppelingen, laatste 120 dagen). */
export async function getFrameAssetByUrl(): Promise<Map<string, string>> {
  try {
    return (await cached()).assetByUrl;
  } catch {
    return new Map();
  }
}

/**
 * De video's voor het kantoorscherm: echte klantvideo's uit Frame.io, gekoppeld
 * aan hun echte Metricool-cijfers. Alleen klanten waar de kijker toegang toe
 * heeft (editors met een beperkte klantscope zien alleen hun eigen klanten).
 */
export async function getScreenReel(viewer: Viewer): Promise<ScreenReel> {
  const { items, metricsDate, generatedAt } = (await cached()).data;
  return { items: items.filter((i) => hasClientAccess(viewer, i.clientId)), metricsDate, generatedAt };
}
