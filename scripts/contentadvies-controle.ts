/**
 * Controle van het Contentadvies op de echte gegevens, zonder iets op te slaan.
 * Leest alleen (publicaties, laatste meting, formatlabels) en rekent met dezelfde
 * functies als de pagina.
 * Gebruik: DATABASE_URL=... tsx scripts/contentadvies-controle.ts
 */
import { Pool } from "pg";
import { analyzeMemory, type MemoryInput } from "@/server/content-memory/analyze";
import { buildAdvice } from "@/server/content-memory/advice";

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
    const a = buildAdvice(m, { clientId: c.id, structures: ai.structures ?? {}, ideas: ai.ideas ?? [] });
    console.log(`\n=== ${c.name}: ${a.videoCount} video's, voldoende=${a.sufficient}, opbouw ${a.coverage.structure}/${a.coverage.total}, kijkdata ${a.coverage.retention}`);
    for (const k of ["meer", "minder", "blijven", "testen"] as const) for (const i of a.sections[k]) console.log(`  [${k}] ${i.title} (${i.proof}, n=${i.n}, ${i.perf ?? "-"}x) :: ${i.advice}${process.env.VERBOSE ? `\n       inzicht: ${i.insight}\n       toepassing: ${i.application}` : ""}`);
    console.log(`  prioriteiten: ${a.priorities.map((p) => p.title).join(" | ")}`);
    console.log(`  opnamedag: ${a.nextShoot.map((l) => `${l.kind}: ${l.text}`).join(" || ")}`);
    console.log(`  cta-doelen: ${a.ctaGoals.map((g) => `${g.goal}${g.measurable ? "" : "(niet meetbaar)"}: ${g.rows.map((x) => `${x.label} n=${x.n} ${x.score ?? "-"}`).join(", ")}`).join(" ; ")}`);
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
