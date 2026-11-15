/**
 * Toetst de transcript-koppeling op analyses waarvan de publicatie al bekend is.
 * Alleen lezen. Gebruik: DATABASE_URL=... tsx scripts/vi-match-check.ts
 */
import { Pool } from "pg";
import { groupPublications, type ReelPublication } from "@/lib/screen-reel-match";
import { matchTranscripts } from "@/lib/transcript-match";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
  const clients = (await pool.query(`select distinct c.id, c.name from clients c join video_analyses a on a.client_id = c.id where a.source_type = 'frameio' order by c.name`)).rows;
  let ok = 0, wrong = 0, none = 0;
  for (const c of clients) {
    const pubs = (await pool.query(`select p.id, p.platform, p.published_at, p.caption, p.duration_seconds, p.external_url from publications p where p.client_id = $1 and p.deleted_at is null and p.status = 'published' and p.published_at is not null`, [c.id])).rows;
    const videos = groupPublications(pubs.map((r): ReelPublication => ({ id: r.id, clientId: c.id, platform: r.platform, publishedAt: new Date(r.published_at), durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds), caption: r.caption, externalUrl: r.external_url, views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0 })));
    const an = (await pool.query(`select a.id, a.publication_id, a.duration_ms, t.full_text, f.frame_created_at from video_analyses a join video_transcripts t on t.analysis_id = a.id left join frame_assets f on f.client_id = a.client_id and (f.media_file_id::text = replace(a.source_url, 'frameio:', '') or f.frame_file_id::text = replace(a.source_url, 'frameio:', '')) where a.client_id = $1 and a.source_type = 'frameio' and a.publication_id is not null`, [c.id])).rows;
    const truth = new Map(an.map((a) => [a.id, videos.find((v) => v.platforms.some((p) => p.publicationId === a.publication_id))?.key]));
    const res = matchTranscripts(videos.map((v) => ({ key: v.key, caption: v.caption, publishedAt: v.publishedAt, durationSeconds: v.durationSeconds })), an.map((a) => ({ id: a.id, transcript: a.full_text ?? "", durationSeconds: a.duration_ms ? a.duration_ms / 1000 : null, createdAt: a.frame_created_at ? new Date(a.frame_created_at) : null })));
    const by = new Map(res.map((r) => [r.analysisId, r]));
    if (process.env.LOOSE) {
      const vs = videos.map((v) => ({ key: v.key, caption: v.caption, publishedAt: v.publishedAt, durationSeconds: v.durationSeconds }));
      for (const a of an) {
        if (by.get(a.id)) continue;
        const one = matchTranscripts(vs, [{ id: a.id, transcript: a.full_text ?? "", durationSeconds: a.duration_ms ? a.duration_ms / 1000 : null, createdAt: a.frame_created_at ? new Date(a.frame_created_at) : null }], { minScore: 0, minMargin: -1, minShared: 0 })[0];
        const t = videos.find((v) => v.key === truth.get(a.id));
        console.log(`  LOS ${c.name}: ${one ? `score ${one.score} marge ${one.margin} gedeeld ${one.shared.length} ${one.videoKey === truth.get(a.id) ? "JUIST" : "ANDERS"}` : "geen kandidaat"} | T: ${String(a.full_text).slice(0, 80)} | verwacht: ${t?.caption.replace(/\s+/g, " ").slice(0, 110)} dur ${t?.durationSeconds}/${a.duration_ms / 1000}`);
      }
    }
    for (const a of an) {
      const r = by.get(a.id);
      if (!r) { none++; if (process.env.VERBOSE) console.log(`  ${c.name}: geen koppeling | ${String(a.full_text).slice(0, 70)}`); }
      else if (r.videoKey === truth.get(a.id)) ok++;
      else { wrong++; console.log(`  ${c.name}: ANDERE koppeling (score ${r.score}, marge ${r.margin}) | ${String(a.full_text).slice(0, 70)} → ${videos.find((v) => v.key === r.videoKey)?.caption.slice(0, 70)} | verwacht: ${videos.find((v) => v.key === truth.get(a.id))?.caption.slice(0, 70)}`); }
    }
    console.log(`${c.name}: ${an.length} analyses, ${videos.length} video's`);
  }
  console.log(`goed ${ok}, anders ${wrong}, geen ${none}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
