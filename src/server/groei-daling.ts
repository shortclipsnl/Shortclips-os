import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { isVideoPost, retentionOf, type Period, type VideoCard } from "@/lib/resultaten-overzicht";
import { classify, type RateStat, type TrendInput, type TrendResult } from "@/lib/groei-daling";
import { goalLabel } from "@/server/reports/strategy";
import type { ClientResult } from "@/server/resultaten-overzicht";

/**
 * Groei en daling per klant voor het bovenste blok van de Resultatenpagina.
 * Hergebruikt de cijfers van loadResultsOverview (zelfde periode, zelfde
 * bronnen) en vult alleen aan wat daar niet in zit: meetdekking, kijktijd en
 * engagement van de vergelijkingsperiode, doelstelling en coördinator.
 */

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const n = (v: unknown) => Number(v ?? 0) || 0;

export type TrendData = TrendResult & { coordinatorBySlug: Record<string, string | null> };

export async function loadGroeiDaling(p: Period, clients: ClientResult[], videos: VideoCard[]): Promise<TrendData> {
  const linked = clients.filter((c) => c.linked);
  if (!linked.length) return { daling: [], groei: [], onvoldoende: [], coordinatorBySlug: {} };
  const ids = linked.map((c) => c.id);
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const pubDay = sql`(p.published_at at time zone 'Europe/Amsterdam')::date`;

  const [metaRes, coverRes, postRes] = await Promise.all([
    db.execute(sql`
      select c.id, c.slug, c.coordinator_id as "coordinatorId", sp.primary_goal as goal
      from clients c left join client_strategy_profiles sp on sp.client_id = c.id
      where c.id in (${idList})`),
    db.execute(sql`
      select client_id,
        count(distinct measured_on) filter (where measured_on >= ${p.from}::date)::int as cur,
        count(distinct measured_on) filter (where measured_on < ${p.prevTo}::date)::int as prev
      from daily_metrics
      where client_id in (${idList}) and measured_on >= ${p.prevFrom}::date and measured_on < ${p.to}::date
      group by client_id`),
    // Video's uit beide periodes met hun laatste meting (kijktijd en engagement).
    db.execute(sql`
      select p.client_id as "clientId", p.platform::text as platform, p.external_url as url,
        p.duration_seconds as "durationSeconds", (${pubDay} >= ${p.from}::date) as cur,
        coalesce(m.views, 0) as views,
        coalesce(m.likes, 0) + coalesce(m.comments, 0) + coalesce(m.shares, 0) + coalesce(m.saves, 0) as inter,
        m.avg_watch_seconds as "avgWatchSeconds", m.completion_rate as "completionRate"
      from publications p
      left join lateral (
        select s.views, s.likes, s.comments, s.shares, s.saves, s.avg_watch_seconds, s.completion_rate
        from social_metrics s where s.publication_id = p.id order by s.measured_on desc limit 1
      ) m on true
      where p.client_id in (${idList}) and p.deleted_at is null and p.status = 'published'
        and ${pubDay} >= ${p.prevFrom}::date and ${pubDay} < ${p.to}::date`),
  ]);

  const meta = new Map(rows<{ id: string; slug: string; coordinatorId: string | null; goal: string | null }>(metaRes).map((r) => [String(r.id), r]));
  const cover = new Map(rows<{ client_id: string; cur: number; prev: number }>(coverRes).map((r) => [String(r.client_id), { cur: n(r.cur), prev: n(r.prev) }]));

  type Acc = { retSum: number; retN: number; views: number; inter: number; engN: number };
  const blank = (): Acc => ({ retSum: 0, retN: 0, views: 0, inter: 0, engN: 0 });
  const stats = new Map<string, { cur: Acc; prev: Acc }>();
  for (const r of rows<Record<string, unknown>>(postRes)) {
    const platform = String(r.platform) as "instagram";
    const url = r.url ? String(r.url) : null;
    const durationSeconds = r.durationSeconds == null ? null : n(r.durationSeconds);
    if (!isVideoPost({ platform, url, durationSeconds })) continue;
    const id = String(r.clientId);
    const s = stats.get(id) ?? { cur: blank(), prev: blank() };
    const a = r.cur === true || r.cur === "t" ? s.cur : s.prev;
    const ret = retentionOf({
      avgWatchSeconds: r.avgWatchSeconds == null ? null : n(r.avgWatchSeconds),
      durationSeconds,
      completionRate: r.completionRate == null ? null : n(r.completionRate),
    });
    if (ret != null && ret > 0) { a.retSum += ret; a.retN++; }
    const views = n(r.views);
    // Engagement alleen op video's met een eerlijke basis.
    if (views >= 200) { a.views += views; a.inter += n(r.inter); a.engN++; }
    stats.set(id, s);
  }
  const rate = (s: { cur: Acc; prev: Acc } | undefined, kind: "ret" | "eng"): RateStat => {
    if (!s) return { cur: null, prev: null, curN: 0, prevN: 0 };
    const v = (a: Acc) => (kind === "ret" ? (a.retN ? a.retSum / a.retN : null) : a.views >= 1000 ? a.inter / a.views : null);
    return { cur: v(s.cur), prev: v(s.prev), curN: kind === "ret" ? s.cur.retN : s.cur.engN, prevN: kind === "ret" ? s.prev.retN : s.prev.engN };
  };

  // Beste hook per klant in deze periode (weergaven t.o.v. het eigen normale niveau).
  const topHook = new Map<string, { hook: string; score: number }>();
  for (const v of videos) {
    if (!v.hook || v.hookScore == null) continue;
    const cur = topHook.get(v.clientId);
    if (!cur || v.hookScore > cur.score) topHook.set(v.clientId, { hook: v.hook, score: v.hookScore });
  }

  const inputs: TrendInput[] = linked.map((c) => {
    const m = meta.get(c.id);
    const cv = cover.get(c.id) ?? { cur: 0, prev: 0 };
    const s = stats.get(c.id);
    return {
      clientId: c.id,
      name: c.name,
      slug: c.slug,
      color: c.color,
      logoUrl: c.logoUrl,
      goal: m?.goal ?? null,
      days: p.days,
      measureDays: cv.cur,
      measureDaysPrev: cv.prev,
      views: c.viewsCompare, viewsPrev: c.viewsPrev,
      reach: c.reachCompare, reachPrev: c.reachPrev,
      followers: c.followers, followersPrev: c.followersPrev,
      retention: rate(s, "ret"),
      engagement: rate(s, "eng"),
      videos: c.videos, videosPrev: c.videosPrev,
      topHook: topHook.get(c.id) ?? null,
    };
  });

  const result = classify(inputs, (g) => (g ? goalLabel(g) : null));
  const coordinatorBySlug: Record<string, string | null> = {};
  for (const m of meta.values()) coordinatorBySlug[m.slug] = m.coordinatorId ?? null;
  return { ...result, coordinatorBySlug };
}
