import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { type Period, type PostRow, videoCards, type VideoCard } from "@/lib/resultaten-overzicht";

/**
 * Data voor de interne resultatenpagina (/analytics), volledig uit de eigen
 * database (dagelijkse Metricool-snapshots). Bronkeuze per cijfer:
 *
 * - Weergaven, bereik, volgersgroei: dagcijfers per account (daily_metrics),
 *   opgeteld over de meetdagen in de periode. Dit zijn echte dagwaarden. Levert
 *   een platform geen accountweergaven, dan tellen de video's van dat platform.
 * - Likes, reacties, opgeslagen: per video/post (social_metrics, laatste
 *   meting) voor posts die in de periode zijn gepubliceerd. Bewust níet uit de
 *   dagcijfers: TikTok levert daar een cumulatief totaal per dag, waardoor
 *   optellen per dag het aantal likes honderden keren dubbel telde.
 * - Gepubliceerde video's: opgeleverde video's met status "gepubliceerd"
 *   (deliverables), zoals voorheen.
 */

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const n = (v: unknown) => Number(v ?? 0);

export type ClientResult = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  logoUrl: string | null;
  linked: boolean;
  /** Totaal weergaven; `viewsCompare` is het deel dat eerlijk met `viewsPrev` te vergelijken is. */
  views: number; viewsPrev: number; viewsCompare: number;
  reach: number; reachPrev: number; reachCompare: number;
  /** true = (een deel van) de weergaven komt uit de cijfers per video. */
  viewsFromPosts: boolean;
  /** false = geen enkele bron levert bereik voor deze klant (toon "Niet beschikbaar"). */
  reachAvailable: boolean;
  followers: number; followersPrev: number;
  likes: number;
  comments: number;
  /** null = geen Instagram-posts in de periode, dus opslagen niet beschikbaar. */
  saves: number | null;
  posts: number;
  videos: number; videosPrev: number;
  /** Weergaven per dag over de periode (voor de minigrafiek). */
  series: number[];
};

export type Overview = {
  clients: ClientResult[];
  totals: {
    views: number; viewsPrev: number; viewsCompare: number;
    reach: number; reachPrev: number; reachCompare: number;
    followers: number; followersPrev: number;
    likes: number; comments: number; saves: number | null; posts: number;
    videos: number; videosPrev: number;
    series: number[];
  };
  videos: VideoCard[];
  lastUpdated: string | null;
};

function dayList(from: string, toExcl: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${toExcl}T00:00:00Z`).getTime();
  while (d.getTime() < end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function loadResultsOverview(p: Period): Promise<Overview> {
  // Alleen actieve, échte klanten (zelfde selectie als voorheen).
  const clientCond = sql`c.deleted_at is null and c.status = 'active' and c.show_in_results = true`;
  const pubDay = sql`(p.published_at at time zone 'Europe/Amsterdam')::date`;

  const [clientRes, dailyRes, seriesRes, postRes, videoRes, updatedRes] = await Promise.all([
    db.execute(sql`
      select c.id, c.name, c.slug, c.color, c.logo_url as "logoUrl",
        (exists (select 1 from daily_metrics d2 where d2.client_id = c.id))::int as linked
      from clients c where ${clientCond}`),

    db.execute(sql`
      select dm.client_id, dm.platform::text as platform,
        coalesce(sum(dm.views) filter (where dm.measured_on >= ${p.from}::date and dm.measured_on < ${p.to}::date), 0)::bigint as views,
        coalesce(sum(dm.views) filter (where dm.measured_on < ${p.prevTo}::date), 0)::bigint as views_prev,
        coalesce(sum(dm.reach) filter (where dm.measured_on >= ${p.from}::date and dm.measured_on < ${p.to}::date), 0)::bigint as reach,
        coalesce(sum(dm.reach) filter (where dm.measured_on < ${p.prevTo}::date), 0)::bigint as reach_prev,
        coalesce(sum(dm.follower_delta) filter (where dm.measured_on >= ${p.from}::date and dm.measured_on < ${p.to}::date), 0)::bigint as followers,
        coalesce(sum(dm.follower_delta) filter (where dm.measured_on < ${p.prevTo}::date), 0)::bigint as followers_prev
      from daily_metrics dm join clients c on c.id = dm.client_id
      where ${clientCond} and dm.measured_on >= ${p.prevFrom}::date and dm.measured_on < ${p.to}::date
      group by dm.client_id, dm.platform`),

    db.execute(sql`
      select dm.client_id, to_char(dm.measured_on, 'YYYY-MM-DD') as day, coalesce(sum(dm.views), 0)::bigint as views
      from daily_metrics dm join clients c on c.id = dm.client_id
      where ${clientCond} and dm.measured_on >= ${p.from}::date and dm.measured_on < ${p.to}::date
      group by 1, 2`),

    // Posts uit de periode met hun laatste meting. Eén rij per post per platform.
    db.execute(sql`
      select p.id, p.client_id as "clientId", c.name as "clientName", c.slug as "clientSlug",
        c.color as "clientColor", c.logo_url as "clientLogoUrl",
        p.platform::text as platform, p.external_url as url, p.caption,
        p.published_at as "publishedAt", p.duration_seconds as "durationSeconds",
        coalesce(p.thumbnail_data, p.thumbnail_url) as thumb,
        coalesce(m.views, 0) as views, coalesce(m.reach, 0) as reach, coalesce(m.likes, 0) as likes,
        coalesce(m.comments, 0) as comments, coalesce(m.shares, 0) as shares, coalesce(m.saves, 0) as saves
      from publications p
      join clients c on c.id = p.client_id
      left join lateral (
        select s.views, s.reach, s.likes, s.comments, s.shares, s.saves
        from social_metrics s where s.publication_id = p.id
        order by s.measured_on desc limit 1
      ) m on true
      where ${clientCond} and p.deleted_at is null and p.status = 'published'
        and ${pubDay} >= ${p.from}::date and ${pubDay} < ${p.to}::date`),

    db.execute(sql`
      select d.client_id,
        count(*) filter (where (d.published_at at time zone 'Europe/Amsterdam')::date >= ${p.from}::date)::int as videos,
        count(*) filter (where (d.published_at at time zone 'Europe/Amsterdam')::date < ${p.prevTo}::date)::int as videos_prev
      from deliverables d join clients c on c.id = d.client_id
      where ${clientCond} and d.deleted_at is null and d.status = 'published'
        and (d.published_at at time zone 'Europe/Amsterdam')::date >= ${p.prevFrom}::date
        and (d.published_at at time zone 'Europe/Amsterdam')::date < ${p.to}::date
      group by 1`),

    db.execute(sql`
      select greatest(
        (select max(updated_at) from daily_metrics),
        (select max(updated_at) from social_metrics)
      ) as ts`),
  ]);

  const days = dayList(p.from, p.to);
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const seriesBy = new Map<string, number[]>();
  for (const r of rows<{ client_id: string; day: string; views: unknown }>(seriesRes)) {
    const i = dayIdx.get(r.day);
    if (i === undefined) continue;
    const s = seriesBy.get(r.client_id) ?? new Array(days.length).fill(0);
    s[i] += n(r.views);
    seriesBy.set(r.client_id, s);
  }

  // Dagcijfers per klant per platform.
  const dailyBy = new Map<string, Map<string, Record<string, unknown>>>();
  for (const r of rows<Record<string, unknown>>(dailyRes)) {
    const id = String(r.client_id);
    const m = dailyBy.get(id) ?? new Map<string, Record<string, unknown>>();
    m.set(String(r.platform ?? ""), r);
    dailyBy.set(id, m);
  }
  const vidBy = new Map(rows<Record<string, unknown>>(videoRes).map((r) => [String(r.client_id), r]));

  const posts: PostRow[] = rows<Record<string, unknown>>(postRes).map((r) => ({
    id: String(r.id),
    clientId: String(r.clientId),
    clientName: String(r.clientName),
    clientSlug: String(r.clientSlug),
    clientColor: r.clientColor ? String(r.clientColor) : null,
    clientLogoUrl: r.clientLogoUrl ? String(r.clientLogoUrl) : null,
    platform: String(r.platform) as PostRow["platform"],
    url: r.url ? String(r.url) : null,
    caption: r.caption ? String(r.caption) : null,
    publishedAt: new Date(String(r.publishedAt)).toISOString(),
    durationSeconds: r.durationSeconds == null ? null : n(r.durationSeconds),
    thumb: r.thumb ? String(r.thumb) : null,
    views: n(r.views), reach: n(r.reach), likes: n(r.likes),
    comments: n(r.comments), shares: n(r.shares), saves: n(r.saves),
  }));
  type Agg = { likes: number; comments: number; saves: number; hasIg: boolean; posts: number; byPlatform: Map<string, { views: number; reach: number }> };
  const postAgg = new Map<string, Agg>();
  for (const p2 of posts) {
    const a = postAgg.get(p2.clientId) ?? { likes: 0, comments: 0, saves: 0, hasIg: false, posts: 0, byPlatform: new Map() };
    a.likes += p2.likes;
    a.comments += p2.comments;
    if (p2.platform === "instagram") { a.saves += p2.saves; a.hasIg = true; }
    a.posts++;
    const bp = a.byPlatform.get(p2.platform) ?? { views: 0, reach: 0 };
    bp.views += p2.views;
    bp.reach += p2.reach;
    a.byPlatform.set(p2.platform, bp);
    postAgg.set(p2.clientId, a);
  }

  const clients: ClientResult[] = rows<Record<string, unknown>>(clientRes).map((c) => {
    const id = String(c.id);
    const v = vidBy.get(id) ?? {};
    const a = postAgg.get(id);
    // Weergaven/bereik per platform uit de accountcijfers. Levert een platform
    // daar niets (bijv. TikTok-accounts zonder weergavenmetric), dan tellen we
    // voor dát platform de video's uit de periode. Nooit beide bronnen voor
    // hetzelfde platform, dus geen dubbele telling. Zonder eerlijke vergelijking
    // (de vorige periode heeft geen meting per video) tellen die niet mee in %.
    const plats = new Set<string>([...(dailyBy.get(id)?.keys() ?? []), ...(a?.byPlatform.keys() ?? [])]);
    const acc = { views: 0, viewsPrev: 0, reach: 0, reachPrev: 0, followers: 0, followersPrev: 0, fbViews: 0, fbReach: 0 };
    for (const pl of plats) {
      const d = dailyBy.get(id)?.get(pl) ?? {};
      const bp = a?.byPlatform.get(pl);
      if (n(d.views) > 0 || n(d.views_prev) > 0) { acc.views += n(d.views); acc.viewsPrev += n(d.views_prev); }
      else if (bp) acc.fbViews += bp.views;
      if (n(d.reach) > 0 || n(d.reach_prev) > 0) { acc.reach += n(d.reach); acc.reachPrev += n(d.reach_prev); }
      else if (bp && pl !== "facebook") acc.fbReach += bp.reach;
      acc.followers += n(d.followers);
      acc.followersPrev += n(d.followers_prev);
    }
    return {
      id,
      name: String(c.name),
      slug: String(c.slug),
      color: c.color ? String(c.color) : null,
      logoUrl: c.logoUrl ? String(c.logoUrl) : null,
      linked: n(c.linked) === 1,
      views: acc.views + acc.fbViews, viewsPrev: acc.viewsPrev, viewsCompare: acc.views,
      reach: acc.reach + acc.fbReach, reachPrev: acc.reachPrev, reachCompare: acc.reach,
      viewsFromPosts: acc.fbViews > 0,
      reachAvailable: acc.reach + acc.reachPrev + acc.fbReach > 0,
      followers: acc.followers, followersPrev: acc.followersPrev,
      likes: a?.likes ?? 0,
      comments: a?.comments ?? 0,
      saves: a?.hasIg ? a.saves : null,
      posts: a?.posts ?? 0,
      videos: n(v.videos), videosPrev: n(v.videos_prev),
      series: seriesBy.get(id) ?? new Array(days.length).fill(0),
    };
  });
  // Gekoppelde klanten eerst, daarna op weergaven.
  clients.sort((a, b) => Number(b.linked) - Number(a.linked) || b.views - a.views || a.name.localeCompare(b.name, "nl"));

  const sum = (f: (c: ClientResult) => number) => clients.reduce((s, c) => s + f(c), 0);
  const anySaves = clients.some((c) => c.saves !== null);
  const totals = {
    views: sum((c) => c.views), viewsPrev: sum((c) => c.viewsPrev), viewsCompare: sum((c) => c.viewsCompare),
    reach: sum((c) => c.reach), reachPrev: sum((c) => c.reachPrev), reachCompare: sum((c) => c.reachCompare),
    followers: sum((c) => c.followers), followersPrev: sum((c) => c.followersPrev),
    likes: sum((c) => c.likes), comments: sum((c) => c.comments),
    saves: anySaves ? sum((c) => c.saves ?? 0) : null,
    posts: sum((c) => c.posts),
    videos: sum((c) => c.videos), videosPrev: sum((c) => c.videosPrev),
    series: days.map((_, i) => sum((c) => c.series[i] ?? 0)),
  };

  const ts = rows<{ ts: unknown }>(updatedRes)[0]?.ts;
  return {
    clients,
    totals,
    videos: videoCards(posts),
    lastUpdated: ts ? new Date(String(ts)).toISOString() : null,
  };
}
