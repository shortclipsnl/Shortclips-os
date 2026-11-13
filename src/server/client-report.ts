import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requireInternal, hasClientAccess } from "@/server/auth/context";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const dayOffset = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Samengestelde klantrapportage uit de echte Metricool-cijfers. Geen verzonnen
 * data: ontbreekt iets, dan blijft het leeg. De inhoudelijke AI-analyse en
 * verbeterpunten worden apart toegevoegd (vereist ANTHROPIC_API_KEY).
 */
/** Dagen tussen twee ISO-datums (inclusief). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
}
function isoShift(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function getClientReport(
  slug: string,
  days = 90,
  trusted = false,
  window?: { from: string; to: string },
) {
  // `trusted` alleen voor vertrouwde server-jobs (geen gebruikerssessie, bv. de
  // nachtelijke AI-verbeterlus). De normale UI-/actiepaden laten dit op false.
  const viewer = trusted ? null : await requireInternal();

  const [client] = await db
    .select({ id: clients.id, name: clients.name, logoUrl: clients.logoUrl, slug: clients.slug })
    .from(clients)
    .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) notFound();
  // Klantscope afdwingen: zonder dit kon elke interne gebruiker zonder
  // "alle klanten"-recht (bv. een freelance videograaf) via /rapport/<slug>
  // het rapport van élke klant openen.
  if (viewer && !hasClientAccess(viewer, client.id)) notFound();

  // Met een expliciet venster (bv. een kalendermaand voor een maandrapport)
  // vergelijken we met de gelijk-lange periode er direct vóór. Zonder venster
  // geldt het rollende `days`-venster vanaf vandaag.
  const start = window ? window.from : dayOffset(-days);
  const end = window ? window.to : dayOffset(0);
  const span = window ? daysBetween(window.from, window.to) : days;
  const prevStart = window ? isoShift(window.from, -span) : dayOffset(-2 * days);
  const prevEnd = window ? isoShift(window.from, -1) : dayOffset(-days - 1);
  const totalsSql = (from: string, to: string) => sql`
    select coalesce(sum(views),0)::bigint views, coalesce(sum(reach),0)::bigint reach,
           coalesce(sum(engagements),0)::bigint engagements, coalesce(sum(follower_delta),0)::int follower_growth,
           coalesce(sum(posts_published),0)::int posts, coalesce(sum(likes),0)::bigint likes,
           coalesce(sum(comments),0)::bigint comments, coalesce(sum(shares),0)::bigint shares, coalesce(sum(saves),0)::bigint saves
    from daily_metrics where client_id = ${client.id} and measured_on >= ${from} and measured_on <= ${to}`;

  // Maandreeks: voor een maandvenster een bredere terugblik (laatste 6 maanden)
  // zodat de maandvergelijking context heeft; anders gewoon het rollende venster.
  const monthsFrom = window ? isoShift(start, -185) : start;
  const [totalsRes, prevRes, perPlatformRes, perMonthRes] = await Promise.all([
    db.execute(totalsSql(start, end)),
    db.execute(totalsSql(prevStart, prevEnd)),
    db.execute(sql`
      select platform, coalesce(sum(views),0)::bigint views, coalesce(sum(reach),0)::bigint reach,
             coalesce(sum(follower_delta),0)::int volgers, coalesce(sum(engagements),0)::bigint engagements
      from daily_metrics where client_id = ${client.id} and measured_on >= ${start} and measured_on <= ${end} and platform is not null
      group by platform order by views desc`),
    db.execute(sql`
      select to_char(measured_on,'YYYY-MM') maand, coalesce(sum(views),0)::bigint views
      from daily_metrics where client_id = ${client.id} and measured_on >= ${monthsFrom} and measured_on <= ${end}
      group by maand order by maand`),
  ]);

  const t = rows<Record<string, number>>(totalsRes)[0] ?? {};
  const prev = rows<Record<string, number>>(prevRes)[0] ?? {};
  const perPlatform = rows<Record<string, string | number>>(perPlatformRes);
  const months = rows<{ maand: string; views: number }>(perMonthRes).map((m) => ({ maand: m.maand, views: Number(m.views) }));

  const pct = (cur: number, was: number) => (was > 0 ? Math.round(((cur - was) / was) * 100) : null);
  const n = (v: unknown) => Number(v ?? 0);
  const views = n(t.views);
  const engagements = n(t.engagements);
  const engagementRate = views > 0 ? Math.round((engagements / views) * 1000) / 10 : null;

  const bestMonth = months.length ? [...months].sort((a, b) => b.views - a.views)[0]! : null;
  const topPlatform = perPlatform[0] ? String(perPlatform[0].platform) : null;

  // Data-gedreven observaties (feitelijk, geen aannames over hooks/retentie).
  const observations: string[] = [];
  const vg = pct(views, n(prev.views));
  if (vg !== null) observations.push(`Weergaven ${vg >= 0 ? "stegen" : "daalden"} met ${Math.abs(vg)}% ten opzichte van de vorige periode.`);
  if (bestMonth) observations.push(`De beste maand was ${bestMonth.maand} met ${bestMonth.views.toLocaleString("nl-NL")} weergaven.`);
  if (topPlatform) observations.push(`Het meeste bereik kwam via ${topPlatform}.`);
  if (n(t.follower_growth) !== 0) observations.push(`De volgersbasis groeide met ${n(t.follower_growth) >= 0 ? "+" : ""}${n(t.follower_growth).toLocaleString("nl-NL")} in deze periode.`);

  return {
    client,
    days: span,
    period: { from: start, to: end },
    totals: {
      views,
      reach: n(t.reach),
      posts: n(t.posts),
      followerGrowth: n(t.follower_growth),
      likes: n(t.likes),
      comments: n(t.comments),
      shares: n(t.shares),
      saves: n(t.saves),
      engagements,
      engagementRate,
      viewsGrowthPct: vg,
      reachGrowthPct: pct(n(t.reach), n(prev.reach)),
      avgPerPost: n(t.posts) > 0 ? Math.round(views / n(t.posts)) : null,
    },
    perPlatform: perPlatform.map((p) => ({ platform: String(p.platform), views: Number(p.views), reach: Number(p.reach), volgers: Number(p.volgers), engagements: Number(p.engagements) })),
    months,
    bestMonth,
    observations,
    hasData: views > 0 || months.length > 0,
  };
}
