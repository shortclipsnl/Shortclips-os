/**
 * Controle van het Contentadvies op de echte gegevens, zonder iets op te slaan.
 * Leest alleen (publicaties, laatste meting, formatlabels) en rekent met dezelfde
 * functies als de pagina.
 * Gebruik: DATABASE_URL=... tsx scripts/contentadvies-controle.ts
 */
import { Pool } from "pg";
import { analyzeMemory, type MemoryInput } from "@/server/content-memory/analyze";
import { buildAdvice, filmStyleOf, tempoOf } from "@/server/content-memory/advice";
import { captionKey } from "@/server/content-memory/analyze";

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const numOrNull = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
  const clients = (await pool.query(`select distinct c.id, c.name from clients c join publications p on p.client_id = c.id and p.deleted_at is null and p.status = 'published' where c.deleted_at is null and c.status::text in ('active','onboarding') order by c.name`)).rows;
  for (const c of clients) {
    const ai = (await pool.query(`select output from ai_outputs where client_id = $1 and tool = 'contentgeheugen' and deleted_at is null order by updated_at desc limit 1`, [c.id])).rows[0]?.output ?? {};
    const pubs = (await pool.query(`
      select p.id, p.platform, p.published_at, p.caption, p.duration_seconds, p.external_url,
             m.views, m.reach, m.likes, m.comments, m.shares, m.saves, m.avg_watch_seconds, m.completion_rate, m.follower_delta, m.link_clicks, m.conversions
      from publications p join lateral (select * from social_metrics s where s.publication_id = p.id order by s.measured_on desc limit 1) m on true
      where p.client_id = $1 and p.deleted_at is null and p.status = 'published'`, [c.id])).rows;
    const inputs: MemoryInput[] = pubs.map((r) => ({
      id: r.id, platform: r.platform, publishedAt: r.published_at ? new Date(r.published_at) : null, caption: r.caption, durationSeconds: numOrNull(r.duration_seconds),
      views: num(r.views), reach: num(r.reach), likes: num(r.likes), comments: num(r.comments), shares: num(r.shares), saves: num(r.saves),
      avgWatchSeconds: numOrNull(r.avg_watch_seconds), completionRate: numOrNull(r.completion_rate), linkClicks: numOrNull(r.link_clicks), conversions: numOrNull(r.conversions),
      followerDelta: num(r.follower_delta), externalUrl: r.external_url, thumbnail: null, spokenHook: null, planTitle: null, planId: null, format: ai.labels?.[r.id] ?? null,
    }));
    const m = analyzeMemory(inputs);
    // Filmstijl en montagetempo uit de video-analyse (zelfde afleiding als de pagina).
    const vi = (await pool.query(`
      select a.caption, em.avg_shot_ms, coalesce(length(t.full_text), 0) > 40 as speech,
        (select jsonb_agg(jsonb_build_object('t', s.shot_type, 'd', s.end_ms - s.start_ms)) from video_shots s where s.analysis_id = a.id and s.shot_type is not null) as shots
      from video_analyses a join video_editing_metrics em on em.analysis_id = a.id left join video_transcripts t on t.analysis_id = a.id
      where a.client_id = $1 and a.deleted_at is null and a.caption is not null`, [c.id])).rows;
    const byKey = new Map(vi.map((r) => [captionKey(r.caption), { style: filmStyleOf({ avgShotMs: r.avg_shot_ms, speech: !!r.speech, shots: r.shots ?? [] }), tempo: tempoOf(r.avg_shot_ms == null ? null : Number(r.avg_shot_ms)) }]));
    const styles: Record<string, string> = {};
    const tempo: Record<string, string> = {};
    for (const v of m.all) { const s = byKey.get(captionKey(v.caption)); if (s?.style) styles[v.id] = s.style; if (s?.tempo) tempo[v.id] = s.tempo; }
    const a = buildAdvice(m, { clientId: c.id, structures: ai.structures ?? {}, ideas: ai.ideas ?? [], styles, tempo });
    const tally = (o: Record<string, string>) => Object.entries(Object.values(o).reduce((acc: Record<string, number>, x) => ({ ...acc, [x]: (acc[x] ?? 0) + 1 }), {})).map(([k, n]) => `${k}: ${n}`).join(", ");
    console.log(`  video-analyse: ${vi.length} video's | filmstijl ${tally(styles) || "-"} | tempo ${tally(tempo) || "-"}`);
    console.log(`\n=== ${c.name}: ${a.videoCount} video's, voldoende=${a.sufficient}, opbouw ${a.coverage.structure}/${a.coverage.total}, kijkdata ${a.coverage.retention}`);
    for (const k of ["meer", "minder", "blijven", "testen"] as const) for (const i of a.sections[k]) console.log(`  [${k}] ${i.title} (${i.proof}, n=${i.n}, ${i.perf ?? "-"}x) :: ${i.advice}${process.env.VERBOSE ? `\n       inzicht: ${i.insight}\n       toepassing: ${i.application}` : ""}`);
    console.log(`  prioriteiten: ${a.priorities.map((p) => p.title).join(" | ")}`);
    console.log(`  opnamedag: ${a.nextShoot.map((l) => `${l.kind}: ${l.text}`).join(" || ")}`);
    console.log(`  cta-doelen: ${a.ctaGoals.map((g) => `${g.goal}${g.measurable ? "" : "(niet meetbaar)"}: ${g.rows.map((x) => `${x.label} n=${x.n} ${x.score ?? "-"}`).join(", ")}`).join(" ; ")}`);
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
