import "server-only";
import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses } from "@/db/schema";
import { assetTitleKey, groupPublications, type ReelPublication } from "@/lib/screen-reel-match";
import { matchTranscripts } from "@/lib/transcript-match";
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
 * Volgorde: eerst het videobestand analyseren, daarna pas koppelen aan de
 * publicatie. De koppeling gebruikt het transcript: wat er in de video gezegd
 * wordt is een veel sterker kenmerk dan de bestandsnaam. Geen zekere koppeling
 * = geen koppeling; er wordt niets geraden.
 */

const FRAME_PREFIX = "frameio:";
const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

export function isAutoAnalysis(a: { modelVersions?: unknown }): boolean {
  return !!(a.modelVersions as { auto?: boolean } | null)?.auto;
}

type PubRow = { id: string; platform: string; published_at: string | Date; caption: string | null; duration_seconds: number | null; external_url: string | null; views: unknown };
type AssetRow = { id: string; name: string; subfolder_name: string | null; duration_seconds: number | null; frame_created_at: string | Date | null; media_file_id: string | null; frame_file_id: string | null };

const ACTIVE_CLIENTS = sql`
  select c.id from clients c
  where c.deleted_at is null and c.status::text in ('active', 'onboarding')
    and exists (select 1 from publications p where p.client_id = c.id and p.deleted_at is null and p.status = 'published')
  order by c.name`;

async function loadVideos(clientId: string) {
  const pubs = rowsOf<PubRow>(await db.execute(sql`
    select p.id, p.platform, p.published_at, p.caption, p.duration_seconds, p.external_url,
           (select s.views from social_metrics s where s.publication_id = p.id order by s.measured_on desc limit 1) as views
    from publications p
    where p.client_id = ${clientId} and p.deleted_at is null and p.status = 'published' and p.published_at is not null`));
  const toPub = (r: PubRow): ReelPublication => ({
    id: r.id, clientId, platform: r.platform, publishedAt: new Date(r.published_at), durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    caption: r.caption, externalUrl: r.external_url, views: num(r.views), reach: 0, likes: 0, comments: 0, shares: 0, saves: 0,
  });
  return groupPublications(pubs.map(toPub));
}

/**
 * Zet nog niet geanalyseerde videobestanden uit de videobibliotheek in de
 * wachtrij, nieuwste eerst. Van elke video alleen de laatste versie. De
 * koppeling met de publicatie volgt ná de analyse, op basis van het transcript
 * (linkAnalyses). Idempotent: een bestand dat al een analyse heeft komt niet
 * opnieuw.
 */
export async function enqueueAutoAnalyses(opts: { max?: number; perClient?: number } = {}): Promise<{ queued: number; clients: number; waiting: number }> {
  const max = opts.max ?? 20;
  const perClient = opts.perClient ?? 8;
  const out = { queued: 0, clients: 0, waiting: 0 };

  for (const c of rowsOf<{ id: string }>(await db.execute(ACTIVE_CLIENTS))) {
    const [assetRes, doneRes, firstRes] = await Promise.all([
      db.execute(sql`
        select id, name, subfolder_name, duration_seconds, frame_created_at, media_file_id, frame_file_id
        from frame_assets where client_id = ${c.id} and deleted_at is null and coalesce(duration_seconds, 0) between 5 and 180
          and frame_created_at is not null`),
      db.execute(sql`select source_url from video_analyses where client_id = ${c.id} and source_url like ${FRAME_PREFIX + "%"}`),
      db.execute(sql`select min(published_at) as at, max(published_at) as last from publications where client_id = ${c.id} and deleted_at is null and status = 'published'`),
    ]);
    const done = new Set(rowsOf<{ source_url: string }>(doneRes).map((r) => r.source_url));
    const firstPub = rowsOf<{ at: string | Date | null }>(firstRes)[0]?.at;
    const lastPub = rowsOf<{ last: string | Date | null }>(firstRes)[0]?.last;
    const published = lastPub ? new Date(lastPub).getTime() : Date.now();
    const from = firstPub ? new Date(firstPub).getTime() - 200 * 86_400_000 : 0;

    // Versies van dezelfde video (V2, V3) samennemen: de nieuwste telt. Ingekorte advertentieversies overslaan.
    const latest = new Map<string, AssetRow>();
    const analysedTitles = new Set<string>();
    for (const a of rowsOf<AssetRow>(assetRes)) {
      if (/verkort|\bad\b|ads?\s*-/i.test(a.subfolder_name ?? "")) continue;
      if (new Date(a.frame_created_at!).getTime() < from) continue;
      const title = assetTitleKey(a.name);
      const key = title ? `${title}|${a.subfolder_name ?? ""}` : `id:${a.id}`;
      const fileId = a.media_file_id ?? a.frame_file_id;
      if (fileId && done.has(FRAME_PREFIX + fileId)) analysedTitles.add(key);
      const prev = latest.get(key);
      if (!prev || new Date(prev.frame_created_at!).getTime() < new Date(a.frame_created_at!).getTime()) latest.set(key, a);
    }
    const todo = [...latest.entries()]
      .filter(([key, a]) => !analysedTitles.has(key) && (a.media_file_id ?? a.frame_file_id))
      .map(([, a]) => a)
      // Eerst bestanden die al gepubliceerd kunnen zijn (nieuwste eerst): die sturen het advies. Nog niet gepubliceerd werk volgt daarna.
      .sort((x, y) => {
        const tx = new Date(x.frame_created_at!).getTime(), ty = new Date(y.frame_created_at!).getTime();
        const px = tx <= published ? 0 : 1, py = ty <= published ? 0 : 1;
        return px - py || ty - tx;
      });

    let n = 0;
    for (const a of todo) {
      if (n >= perClient || out.queued >= max) { out.waiting++; continue; }
      const res = await db.insert(videoAnalyses).values({
        clientId: c.id,
        title: a.name.slice(0, 240),
        sourceType: "frameio",
        sourceUrl: FRAME_PREFIX + (a.media_file_id ?? a.frame_file_id),
        status: "queued",
        modelVersions: { auto: true },
      }).onConflictDoNothing().returning({ id: videoAnalyses.id });
      if (res.length) { n++; out.queued++; }
    }
    if (n) out.clients++;
  }
  return out;
}

/**
 * Koppelt geanalyseerde videobestanden aan hun publicatie op basis van het
 * transcript (en de duur). Draait na elke verwerkingsronde. Een bestaande
 * koppeling wordt vervangen als het transcript duidelijk naar een andere video
 * wijst, en losgelaten als niets haar meer draagt: liever geen koppeling dan
 * een verkeerde.
 */
export async function linkAnalyses(): Promise<{ linked: number; changed: number; unlinked: number; open: number }> {
  const out = { linked: 0, changed: 0, unlinked: 0, open: 0 };
  for (const c of rowsOf<{ id: string }>(await db.execute(ACTIVE_CLIENTS))) {
    const rows = rowsOf<{ id: string; publication_id: string | null; duration_ms: number | null; full_text: string | null; frame_created_at: string | Date | null }>(await db.execute(sql`
      select a.id, a.publication_id, a.duration_ms, t.full_text,
        (select f.frame_created_at from frame_assets f where f.client_id = a.client_id
           and (f.media_file_id::text = substr(a.source_url, 9) or f.frame_file_id::text = substr(a.source_url, 9)) limit 1) as frame_created_at
      from video_analyses a
      join video_transcripts t on t.analysis_id = a.id
      where a.client_id = ${c.id} and a.deleted_at is null and a.source_type = 'frameio'`));
    if (!rows.length) continue;
    const videos = await loadVideos(c.id);
    const matches = new Map(matchTranscripts(
      videos.map((v) => ({ key: v.key, caption: v.caption, publishedAt: v.publishedAt, durationSeconds: v.durationSeconds })),
      rows.map((r) => ({ id: r.id, transcript: r.full_text ?? "", durationSeconds: r.duration_ms ? r.duration_ms / 1000 : null, createdAt: r.frame_created_at ? new Date(r.frame_created_at) : null })),
    ).map((m) => [m.analysisId, m]));

    for (const r of rows) {
      const m = matches.get(r.id);
      const v = m ? videos.find((x) => x.key === m.videoKey) : null;
      if (v) {
        const lead = v.platforms[0];
        const same = v.platforms.some((p) => p.publicationId === r.publication_id);
        if (same) continue;
        await db.update(videoAnalyses).set({ publicationId: lead.publicationId, caption: v.caption, platform: lead.platform as typeof videoAnalyses.$inferInsert.platform, updatedAt: new Date() }).where(eq(videoAnalyses.id, r.id));
        if (r.publication_id) out.changed++; else out.linked++;
        continue;
      }
      if (!r.publication_id) { out.open++; continue; }
      // Geen transcript-koppeling: een eerdere koppeling blijft alleen staan als de duur op de seconde klopt.
      const old = videos.find((x) => x.platforms.some((p) => p.publicationId === r.publication_id));
      const durOk = !!old?.durationSeconds && !!r.duration_ms && Math.abs(old.durationSeconds - r.duration_ms / 1000) <= 1;
      if (durOk) continue;
      await db.update(videoAnalyses).set({ publicationId: null, caption: null, updatedAt: new Date() }).where(eq(videoAnalyses.id, r.id));
      out.unlinked++;
    }
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
