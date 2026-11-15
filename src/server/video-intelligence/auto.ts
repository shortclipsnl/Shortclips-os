import "server-only";
import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses } from "@/db/schema";
import { captionKey } from "@/server/content-memory/analyze";
import { groupPublications, matchVideosToAssets, type ReelAsset, type ReelPublication } from "@/lib/screen-reel-match";
import { ensureWorkDir } from "./paths";

/**
 * Automatische video-analyse voor het Contentgeheugen.
 *
 * Elke gepubliceerde klantvideo waarvan het origineel in de videobibliotheek
 * (Frame.io) staat, wordt één keer in de wachtrij gezet. De worker haalt het
 * bestand op, telt de shots, maakt het transcript en laat de beelden duiden.
 * Zo weet het Contentadvies per video hoe het middenstuk en de montage eruit
 * zien, in plaats van dat af te leiden uit de caption.
 *
 * Koppeling publicatie → videobestand, in volgorde van zekerheid:
 *  1. de contentplanning (het geplande bericht verwijst naar het videobestand);
 *  2. dezelfde koppellogica als het kantoorscherm (titel, duur en datum).
 * Geen koppeling = geen analyse; er wordt niets geraden.
 */

const FRAME_PREFIX = "frameio:";
const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

export function isAutoAnalysis(a: { modelVersions?: unknown }): boolean {
  return !!(a.modelVersions as { auto?: boolean } | null)?.auto;
}

type PubRow = {
  id: string; platform: string; published_at: string | Date | null; caption: string | null; duration_seconds: number | null; external_url: string | null;
  views: unknown; reach: unknown; likes: unknown; comments: unknown; shares: unknown; saves: unknown;
};
type AssetRow = { id: string; name: string; subfolder_name: string | null; duration_seconds: number | null; frame_created_at: string | Date | null; media_file_id: string | null; frame_file_id: string | null };

/**
 * Zet nog niet geanalyseerde video's in de wachtrij. Per klant eerst de best en
 * slechtst presterende en de nieuwste video's, omdat die het advies het meest
 * sturen. Idempotent: een video die al een analyse heeft komt niet opnieuw.
 */
export async function enqueueAutoAnalyses(opts: { max?: number; perClient?: number } = {}): Promise<{ queued: number; clients: number; unmatched: number }> {
  const max = opts.max ?? 20;
  const perClient = opts.perClient ?? 6;
  const out = { queued: 0, clients: 0, unmatched: 0 };
  const clients = rowsOf<{ id: string }>(await db.execute(sql`
    select c.id from clients c
    where c.deleted_at is null and c.status::text in ('active', 'onboarding')
      and exists (select 1 from publications p where p.client_id = c.id and p.deleted_at is null and p.status = 'published')
    order by c.name`));

  for (const c of clients) {
    if (out.queued >= max) break;
    const [pubRes, assetRes, planRes, doneRes] = await Promise.all([
      db.execute(sql`
        select p.id, p.platform, p.published_at, p.caption, p.duration_seconds, p.external_url,
               m.views, m.reach, m.likes, m.comments, m.shares, m.saves
        from publications p
        join lateral (select views, reach, likes, comments, shares, saves from social_metrics s where s.publication_id = p.id order by s.measured_on desc limit 1) m on true
        where p.client_id = ${c.id} and p.deleted_at is null and p.status = 'published' and p.published_at is not null`),
      db.execute(sql`
        select id, name, subfolder_name, duration_seconds, frame_created_at, media_file_id, frame_file_id
        from frame_assets where client_id = ${c.id} and deleted_at is null and coalesce(duration_seconds, 0) > 0`),
      db.execute(sql`
        select caption, frame_asset_id from content_calendar
        where client_id = ${c.id} and deleted_at is null and frame_asset_id is not null and caption is not null and length(caption) > 20`).catch(() => [] as unknown),
      db.execute(sql`select source_url from video_analyses where client_id = ${c.id} and source_url like ${FRAME_PREFIX + "%"}`),
    ]);
    const pubs = rowsOf<PubRow>(pubRes);
    const assets = rowsOf<AssetRow>(assetRes);
    if (!pubs.length || !assets.length) continue;
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const done = new Set(rowsOf<{ source_url: string }>(doneRes).map((r) => r.source_url));

    const toPub = (r: PubRow): ReelPublication => ({
      id: r.id, clientId: c.id, platform: r.platform, publishedAt: new Date(r.published_at!), durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
      caption: r.caption, externalUrl: r.external_url, views: num(r.views), reach: num(r.reach), likes: num(r.likes), comments: num(r.comments), shares: num(r.shares), saves: num(r.saves),
    });
    const videos = groupPublications(pubs.map(toPub));
    const rowOf = (platform: string, url: string | null) => pubs.find((x) => x.platform === platform && x.external_url === url);

    // 1. Via de contentplanning.
    const planned = new Map<string, string>();
    for (const r of rowsOf<{ caption: string; frame_asset_id: string }>(planRes)) {
      const k = captionKey(r.caption);
      if (k.length >= 20 && assetById.has(r.frame_asset_id)) planned.set(k, r.frame_asset_id);
    }
    // 2. Via titel, duur en datum.
    const assetList: ReelAsset[] = assets.map((a) => ({ id: a.id, clientId: c.id, name: a.name, subfolderName: a.subfolder_name, durationSeconds: a.duration_seconds, frameCreatedAt: a.frame_created_at ? new Date(a.frame_created_at) : null }));
    const matched = new Map(matchVideosToAssets(videos, assetList).map((m) => [m.video, m.asset.id]));

    type Cand = { pub: PubRow; assetId: string; views: number; at: number };
    const cands: Cand[] = [];
    for (const v of videos) {
      const members = v.platforms.map((pl) => rowOf(pl.platform, pl.url)).filter((r): r is PubRow => !!r);
      const lead = [...members].sort((a, b) => num(b.views) - num(a.views))[0];
      if (!lead) continue;
      const assetId = planned.get(captionKey(lead.caption)) ?? matched.get(v);
      if (!assetId) { out.unmatched++; continue; }
      const a = assetById.get(assetId)!;
      const fileId = a.media_file_id ?? a.frame_file_id;
      if (!fileId || done.has(FRAME_PREFIX + fileId)) continue;
      cands.push({ pub: lead, assetId, views: num(lead.views), at: new Date(lead.published_at!).getTime() });
    }
    if (!cands.length) continue;

    // Volgorde: afwisselend best, zwakst en nieuwst.
    const byViews = [...cands].sort((a, b) => b.views - a.views);
    const byNew = [...cands].sort((a, b) => b.at - a.at);
    const order: Cand[] = [];
    for (let i = 0; order.length < cands.length && i < cands.length; i++) {
      for (const x of [byViews[i], byViews[byViews.length - 1 - i], byNew[i]]) if (x && !order.includes(x)) order.push(x);
    }

    let n = 0;
    const seen = new Set<string>();
    for (const cand of order) {
      if (n >= perClient || out.queued >= max) break;
      const a = assetById.get(cand.assetId)!;
      const fileId = (a.media_file_id ?? a.frame_file_id)!;
      if (seen.has(fileId)) continue;
      seen.add(fileId);
      const p = cand.pub;
      const res = await db.insert(videoAnalyses).values({
        clientId: c.id,
        publicationId: p.id,
        title: a.name.slice(0, 240),
        platform: p.platform as typeof videoAnalyses.$inferInsert.platform,
        sourceType: "frameio",
        sourceUrl: FRAME_PREFIX + fileId,
        caption: p.caption,
        status: "queued",
        modelVersions: { auto: true },
        metricsSnapshot: { views: num(p.views), likes: num(p.likes), comments: num(p.comments), shares: num(p.shares), saves: num(p.saves) },
      }).onConflictDoNothing().returning({ id: videoAnalyses.id });
      if (res.length) { n++; out.queued++; }
    }
    if (n) out.clients++;
  }
  return out;
}

/** Haalt het videobestand uit Frame.io op naar het werkpad van de analyse. */
export async function downloadFrameSource(analysisId: string, sourceUrl: string): Promise<{ ok: true; mediaPath: string; fileSizeBytes: number } | { ok: false; reason: string }> {
  const fileId = sourceUrl.startsWith(FRAME_PREFIX) ? sourceUrl.slice(FRAME_PREFIX.length) : "";
  if (!fileId) return { ok: false, reason: "Geen videobestand gekoppeld." };
  try {
    const { frameio } = await import("@/server/integrations/frameio");
    const url = await frameio.getFilePlayback(fileId);
    if (!url) return { ok: false, reason: "Frame.io gaf geen afspeelbestand voor deze video." };
    const res = await fetch(url);
    if (!res.ok || !res.body) return { ok: false, reason: `Videobestand ophalen uit Frame.io mislukt (HTTP ${res.status}).` };
    const dir = await ensureWorkDir(analysisId);
    const abs = path.join(dir, "source.mp4");
    await streamPipeline(Readable.fromWeb(res.body as never), createWriteStream(abs));
    const size = (await stat(abs)).size;
    if (size < 10_000) return { ok: false, reason: "Videobestand uit Frame.io is leeg of onvolledig." };
    return { ok: true, mediaPath: abs, fileSizeBytes: size };
  } catch (e) {
    return { ok: false, reason: `Videobestand ophalen uit Frame.io mislukt: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}
