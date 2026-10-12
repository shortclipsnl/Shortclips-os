import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireInternal } from "@/server/auth/context";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export type ScreenClient = {
  name: string;
  slug: string;
  views: number;
  reach: number;
  followerDelta: number;
  posts: number;
  prevViews: number;
  growthPct: number | null;
};

/**
 * Geaggregeerde resultaten voor het kantoorscherm — uitsluitend echte
 * Metricool-cijfers, geen vertrouwelijke financiële gegevens. Periode = laatste
 * 30 dagen t.o.v. de 30 dagen daarvoor.
 */
export async function getScreenData(days = 30) {
  await requireInternal();
  const start = dayOffset(-days);
  const prevStart = dayOffset(-2 * days);
  const prevEnd = dayOffset(-days - 1);

  const totalsSql = (from: string, to: string) => sql`
    select coalesce(sum(views),0)::bigint views, coalesce(sum(reach),0)::bigint reach,
           coalesce(sum(engagements),0)::bigint engagements, coalesce(sum(follower_delta),0)::int follower_growth,
           coalesce(sum(posts_published),0)::int posts, coalesce(sum(likes),0)::bigint likes,
           coalesce(sum(comments),0)::bigint comments
    from daily_metrics where measured_on >= ${from} and measured_on <= ${to}`;

  const [totalsRes, prevRes, perClientRes, prevClientRes, trendRes] = await Promise.all([
    db.execute(totalsSql(start, dayOffset(0))),
    db.execute(totalsSql(prevStart, prevEnd)),
    db.execute(sql`
      select c.name, c.slug,
             coalesce(sum(dm.views),0)::bigint views, coalesce(sum(dm.reach),0)::bigint reach,
             coalesce(sum(dm.follower_delta),0)::int follower_delta, coalesce(sum(dm.posts_published),0)::int posts
      from daily_metrics dm join clients c on c.id = dm.client_id
      where dm.measured_on >= ${start} and dm.measured_on <= ${dayOffset(0)} and c.deleted_at is null
      group by c.name, c.slug`),
    db.execute(sql`
      select c.slug, coalesce(sum(dm.views),0)::bigint views
      from daily_metrics dm join clients c on c.id = dm.client_id
      where dm.measured_on >= ${prevStart} and dm.measured_on <= ${prevEnd} and c.deleted_at is null
      group by c.slug`),
    db.execute(sql`
      select measured_on::text d, coalesce(sum(views),0)::bigint views
      from daily_metrics where measured_on >= ${start} and measured_on <= ${dayOffset(0)}
      group by measured_on order by measured_on`),
  ]);

  const t = rows<Record<string, number>>(totalsRes)[0] ?? {};
  const prev = rows<Record<string, number>>(prevRes)[0] ?? {};
  const prevByClient = new Map(rows<{ slug: string; views: number }>(prevClientRes).map((r) => [r.slug, Number(r.views)]));

  const clients: ScreenClient[] = rows<Record<string, string | number>>(perClientRes).map((r) => {
    const views = Number(r.views);
    const prevViews = prevByClient.get(String(r.slug)) ?? 0;
    const growthPct = prevViews > 0 ? Math.round(((views - prevViews) / prevViews) * 100) : null;
    return {
      name: String(r.name),
      slug: String(r.slug),
      views,
      reach: Number(r.reach),
      followerDelta: Number(r.follower_delta),
      posts: Number(r.posts),
      prevViews,
      growthPct,
    };
  });

  const topByViews = [...clients].sort((a, b) => b.views - a.views).slice(0, 6);
  const withGrowth = clients.filter((c) => c.growthPct !== null);
  const risers = [...withGrowth].sort((a, b) => (b.growthPct! - a.growthPct!)).slice(0, 5);
  const laggards = [...withGrowth].sort((a, b) => (a.growthPct! - b.growthPct!)).filter((c) => (c.growthPct ?? 0) < 0).slice(0, 5);
  const trend = rows<{ d: string; views: number }>(trendRes).map((r) => ({ d: r.d, views: Number(r.views) }));

  const pct = (cur: number, was: number) => (was > 0 ? Math.round(((cur - was) / was) * 100) : null);

  return {
    days,
    totals: {
      views: Number(t.views ?? 0),
      reach: Number(t.reach ?? 0),
      posts: Number(t.posts ?? 0),
      followerGrowth: Number(t.follower_growth ?? 0),
      engagements: Number(t.engagements ?? 0),
      viewsGrowthPct: pct(Number(t.views ?? 0), Number(prev.views ?? 0)),
      reachGrowthPct: pct(Number(t.reach ?? 0), Number(prev.reach ?? 0)),
    },
    clientCount: clients.length,
    topByViews,
    risers,
    laggards,
    trend,
  };
}
