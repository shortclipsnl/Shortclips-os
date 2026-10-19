import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePermission, assertClientAccess } from "@/server/auth/context";
import { Card, CardHeader, ClientLogo, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { compact, formatDate, num } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
import { ClientSelector, type SelectorClient } from "../client-selector";
import { VideoThumb } from "../video-thumb";

// Vaste platformvolgorde voor de filterknoppen.
const PLATFORM_ORDER = ["instagram", "tiktok", "facebook", "youtube", "linkedin"] as const;

export const metadata: Metadata = { title: "Klantresultaten" };
export const dynamic = "force-dynamic";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

export default async function ClientResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ dagen?: string; platform?: string }>;
}) {
  const viewer = await requirePermission("analytics:read");
  const { slug } = await params;
  const sp = await searchParams;
  const days = Number(sp.dagen) || 90;
  const platform = sp.platform && PLATFORM[sp.platform] ? sp.platform : null;

  const [client] = await db
    .select({ id: clients.id, name: clients.name, color: clients.color, logoUrl: clients.logoUrl, quota: clients.monthlyVideoQuota })
    .from(clients)
    .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) notFound();
  assertClientAccess(viewer, client.id);
  const cid = client.id;
  const dInt = `interval '${days} days'`;
  const dPrev = `interval '${2 * days} days'`;
  // Platformfilter voor de cijfers uit daily_metrics (leeg = alle platforms).
  const platCond = platform ? sql`and platform = ${platform}` : sql``;
  const qp = (d: number) => `/analytics/${slug}?dagen=${d}${platform ? `&platform=${platform}` : ""}`;
  const qpPlat = (p: string | null) => `/analytics/${slug}?dagen=${days}${p ? `&platform=${p}` : ""}`;

  const [totals, prevTotals, perMonth, perPlatform, videoRows, publishedRow, allClientsRaw] =
    await Promise.all([
      db.execute(sql`
        select coalesce(sum(views),0)::int views, coalesce(sum(reach),0)::int reach, coalesce(sum(engagements),0)::int engagements,
               coalesce(sum(follower_delta),0)::int follower_growth, coalesce(sum(posts_published),0)::int posts,
               coalesce(sum(likes),0)::int likes, coalesce(sum(comments),0)::int comments,
               coalesce(sum(shares),0)::int shares, coalesce(sum(saves),0)::int saves,
               coalesce(sum(watch_seconds),0)::bigint watch_seconds, coalesce(sum(video_views),0)::bigint video_views
        from daily_metrics where client_id = ${cid} and measured_on >= current_date - ${sql.raw(dInt)} ${platCond}`),
      db.execute(sql`
        select coalesce(sum(views),0)::int views, coalesce(sum(reach),0)::int reach, coalesce(sum(engagements),0)::int engagements,
               coalesce(sum(follower_delta),0)::int follower_growth
        from daily_metrics where client_id = ${cid}
          and measured_on >= current_date - ${sql.raw(dPrev)} and measured_on < current_date - ${sql.raw(dInt)} ${platCond}`),
      db.execute(sql`
        select to_char(measured_on,'YYYY-MM') maand, coalesce(sum(views),0)::int views
        from daily_metrics where client_id = ${cid} and measured_on >= current_date - interval '12 months' ${platCond}
        group by 1 order by 1`),
      db.execute(sql`
        select platform, coalesce(sum(views),0)::int views, coalesce(sum(reach),0)::int reach, coalesce(sum(follower_delta),0)::int volgers
        from daily_metrics where client_id = ${cid} and platform is not null and measured_on >= current_date - ${sql.raw(dInt)}
        group by 1 order by 2 desc`),
      // Alle gepubliceerde video's van deze klant, met cijfers samengevoegd over platforms.
      db.execute(sql`
        with pm as (
          select publication_id, max(views) views, max(likes) likes, max(comments) comments,
                 max(shares) shares, max(saves) saves, max(avg_watch_seconds) avg_watch, max(completion_rate) completion
          from social_metrics where client_id = ${cid} group by publication_id
        )
        select d.id, d.title, d.thumbnail_url, d.frame_url, d.duration_seconds, d.published_at,
               string_agg(distinct p.platform::text, ',') platforms,
               coalesce(sum(pm.views),0)::int views, coalesce(sum(pm.likes),0)::int likes,
               coalesce(sum(pm.comments),0)::int comments, coalesce(sum(pm.shares),0)::int shares,
               coalesce(sum(pm.saves),0)::int saves,
               avg(pm.avg_watch) filter (where pm.avg_watch is not null) avg_watch,
               avg(pm.completion) filter (where pm.completion is not null) completion
        from deliverables d
        left join publications p on p.deliverable_id = d.id and p.deleted_at is null
        left join pm on pm.publication_id = p.id
        where d.client_id = ${cid} and d.deleted_at is null and d.status = 'published'
        group by d.id, d.title, d.thumbnail_url, d.frame_url, d.duration_seconds, d.published_at
        order by views desc, d.published_at desc nulls last`),
      db.execute(sql`select count(*)::int n from deliverables where client_id = ${cid} and deleted_at is null and status = 'published'`),
      db.execute(sql`select slug, name, color, status from clients where deleted_at is null order by (status = 'active') desc, name`),
    ]);

  const t = rows<Record<string, number>>(totals)[0] ?? {};
  const prev = rows<Record<string, number>>(prevTotals)[0] ?? {};
  const months = rows<Record<string, string | number>>(perMonth);
  const platforms = rows<Record<string, string | number>>(perPlatform);
  const videos = rows<VideoRow>(videoRows);
  const publishedTotal = Number(rows<Record<string, number>>(publishedRow)[0]?.n ?? 0);
  const selectorClients = rows<Record<string, string | null>>(allClientsRaw).map((c) => ({
    slug: String(c.slug), name: String(c.name), color: c.color ? String(c.color) : null, status: String(c.status),
  })) as SelectorClient[];

  const avgViews = publishedTotal > 0 ? Math.round(Number(t.views ?? 0) / publishedTotal) : 0;
  const maxMonth = Math.max(1, ...months.map((m) => Number(m.views)));
  // Gemiddelde kijktijd = totale kijktijd / videoweergaven (uit Metricool reels).
  const videoViews = Number(t.video_views ?? 0);
  const avgWatch = videoViews > 0 ? Number(t.watch_seconds ?? 0) / videoViews : null;
  // Uitkijkpercentage/retentie levert Metricool niet; blijft "—".
  const completionPct: number | null = null;

  const deltaPct = (cur: number, p: number): number | null => (p > 0 ? Math.round(((cur - p) / p) * 100) : null);
  const deltaHint = (cur: number, p: number): string | undefined => {
    const d = deltaPct(cur, p);
    return d === null ? undefined : `${d >= 0 ? "+" : ""}${d}% vs vorige periode`;
  };
  const deltaTone = (cur: number, p: number): "good" | "bad" | undefined => {
    const d = deltaPct(cur, p);
    return d === null ? undefined : d >= 0 ? "good" : "bad";
  };

  const hasData = Number(t.views ?? 0) > 0 || months.length > 0 || videos.length > 0;
  const top = videos.slice(0, 5);
  const bottom = videos.filter((v) => Number(v.views) > 0).slice(-5).reverse();

  // Bevindingen: concrete inzichten uit de cijfers (deterministisch, geen AI).
  const findings: string[] = [];
  {
    const vD = deltaPct(Number(t.views ?? 0), Number(prev.views ?? 0));
    if (vD !== null) findings.push(`Weergaven zijn met ${Math.abs(vD)}% ${vD >= 0 ? "gestegen" : "gedaald"} ten opzichte van de vorige periode.`);
    const fg = Number(t.follower_growth ?? 0);
    if (fg !== 0) findings.push(fg > 0 ? `Er kwamen ${num(fg)} nieuwe volgers bij in deze periode.` : `Het volgersaantal daalde met ${num(Math.abs(fg))}.`);
    if (!platform && platforms.length > 0) {
      const best = platforms[0]!;
      findings.push(`${PLATFORM[String(best.platform)]?.label ?? String(best.platform)} levert de meeste weergaven (${compact(Number(best.views))}).`);
    }
    if (top.length > 0 && Number(top[0]!.views) > 0) {
      findings.push(`Best bekeken video: “${top[0]!.title}” met ${compact(Number(top[0]!.views))} weergaven.`);
    }
    if (avgViews > 0) findings.push(`Gemiddeld haalt een video ${compact(avgViews)} weergaven.`);
    if (avgWatch != null) findings.push(`De gemiddelde kijktijd is ${avgWatch.toFixed(1)} seconden per videoweergave.`);
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href="/analytics" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← Resultaten</Link>
      <PageHeader
        title={<span className="flex items-center gap-3"><ClientLogo name={client.name} logoUrl={client.logoUrl} color={client.color} size={40} />{client.name}</span>}
        description={`Volledige resultaten · afgelopen ${days} dagen${platform ? ` · ${PLATFORM[platform]?.label}` : ""} · uit je eigen database (dagelijkse snapshots)`}
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5">
              {[30, 90, 365].map((d) => (
                <Link key={d} href={qp(d)} className={days === d ? "rounded-[4px] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white" : "px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)]"}>
                  {d === 365 ? "1 jaar" : `${d} dagen`}
                </Link>
              ))}
            </div>
            <a href={`/rapport/${slug}?dagen=${days}`} target="_blank" rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-700)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              title="Genereer een klantenrapportage (PDF)">
              <FileText className="size-4" /> Genereer rapportage
            </a>
          </div>
        }
      />

      <ClientSelector clients={selectorClients} currentSlug={slug} />

      {/* Platformfilter: klik op een platform om alleen die cijfers te zien. */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        <Link href={qpPlat(null)} className={platChip(!platform)}>Alle platforms</Link>
        {PLATFORM_ORDER.filter((p) => PLATFORM[p]).map((p) => (
          <Link key={p} href={qpPlat(p)} className={platChip(platform === p)}>
            <span className="size-2 rounded-full" style={{ background: PLATFORM[p]!.color }} />
            {PLATFORM[p]!.label}
          </Link>
        ))}
      </div>

      {!hasData ? (
        <Card><EmptyState title="Nog geen resultaten" description="Zodra Metricool cijfers voor deze klant levert, verschijnen ze hier." /></Card>
      ) : (
        <>
          <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-bold tracking-tight text-white">Algemene prestaties</div>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Gepubliceerde video's" value={num(publishedTotal)} />
            <Stat label="Weergaven" value={compact(Number(t.views ?? 0))} hint={deltaHint(Number(t.views ?? 0), Number(prev.views ?? 0))} tone={deltaTone(Number(t.views ?? 0), Number(prev.views ?? 0))} />
            <Stat label="Bereik" value={compact(Number(t.reach ?? 0))} hint={deltaHint(Number(t.reach ?? 0), Number(prev.reach ?? 0))} tone={deltaTone(Number(t.reach ?? 0), Number(prev.reach ?? 0))} />
            <Stat label="Gem. per video" value={compact(avgViews)} />
            <Stat label="Nieuwe volgers" value={`${Number(t.follower_growth ?? 0) >= 0 ? "+" : ""}${num(Number(t.follower_growth ?? 0))}`} hint={deltaHint(Number(t.follower_growth ?? 0), Number(prev.follower_growth ?? 0))} tone={deltaTone(Number(t.follower_growth ?? 0), Number(prev.follower_growth ?? 0))} />
            <Stat label="Likes" value={compact(Number(t.likes ?? 0))} />
            <Stat label="Reacties" value={compact(Number(t.comments ?? 0))} />
            <Stat label="Shares" value={compact(Number(t.shares ?? 0))} />
            <Stat label="Saves" value={compact(Number(t.saves ?? 0))} />
            <Stat label="Gem. kijktijd" value={avgWatch != null ? `${avgWatch.toFixed(1)}s` : "—"} hint={avgWatch == null ? "geen reels-data" : undefined} />
            <Stat label="Profielbezoeken" value="—" hint="niet via Metricool" />
            <Stat label="Uitkijkpercentage" value={completionPct != null ? `${completionPct}%` : "—"} hint="niet via Metricool" />
          </div>

          {/* Bevindingen op basis van de resultaten. */}
          {findings.length > 0 ? (
            <Card className="mb-5 border-[var(--color-info)]/25 bg-[var(--color-info-soft)]/40">
              <h3 className="text-sm font-semibold">Bevindingen</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {findings.map((f, i) => (
                  <li key={i} className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>{f}</span></li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="mb-5 grid gap-5 xl:grid-cols-2">
            {/* Weergaven per maand */}
            <Card padded={false}>
              <CardHeader title="Weergaven per maand" className="p-5 pb-2" />
              {months.length === 0 ? <EmptyState title="Nog geen maanddata" /> : (
                <div className="space-y-2 p-5 pt-1">
                  {months.map((m) => (
                    <div key={String(m.maand)} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs text-[var(--color-ink-muted)]">{String(m.maand)}</span>
                      <span className="h-3 rounded-full bg-[var(--color-indigo-ink)]" style={{ width: `${Math.max(3, (Number(m.views) / maxMonth) * 100)}%` }} />
                      <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">{compact(Number(m.views))}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Per platform */}
            <Card padded={false}>
              <CardHeader title="Per platform" className="p-5 pb-2" />
              {platforms.length === 0 ? <EmptyState title="Nog geen platformdata" /> : (
                <Table head={<><th className="sc-th">Platform</th><th className="sc-th text-right">Weergaven</th><th className="sc-th text-right">Bereik</th><th className="sc-th text-right">Volgers</th></>}>
                  {platforms.map((p) => (
                    <tr key={String(p.platform)}>
                      <td className="sc-td"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: PLATFORM[String(p.platform)]?.color ?? "#999" }} />{PLATFORM[String(p.platform)]?.label ?? String(p.platform)}</span></td>
                      <td className="sc-td text-right tabular-nums">{compact(Number(p.views))}</td>
                      <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{compact(Number(p.reach))}</td>
                      <td className="sc-td text-right tabular-nums">+{num(Number(p.volgers))}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>

          {/* Gepubliceerde video's — met thumbnail, platform en resultaten per video */}
          <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-bold tracking-tight text-white">Gepubliceerde video&apos;s</div>
          {videos.length === 0 ? (
            <Card><EmptyState title="Nog geen gepubliceerde video's" description="Zodra er video's live staan en Metricool cijfers levert, verschijnen ze hier." /></Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {videos.slice(0, 24).map((v) => <VideoCard key={v.id} v={v} />)}
              </div>
              {videos.length > 24 ? (
                <p className="mt-2 text-xs text-[var(--color-ink-muted)]">De 24 best bekeken van {videos.length} gepubliceerde video&apos;s worden getoond.</p>
              ) : null}
            </>
          )}

          {bottom.length > 0 ? (
            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <Card padded={false}>
                <CardHeader title="Best presterende video's" className="p-5 pb-2" />
                <VideoList items={top} />
              </Card>
              <Card padded={false}>
                <CardHeader title="Minst presterende video's" className="p-5 pb-2" />
                <VideoList items={bottom} />
              </Card>
            </div>
          ) : null}

          <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
            Cijfers komen uit dagelijkse snapshots (Metricool). Weergaven en interacties zijn vrijwel actueel; bereik,
            kijktijd en uitkijkpercentage lopen bij de meeste platforms één tot drie dagen achter en zijn niet op elk
            platform via de API beschikbaar. Ontbrekende waarden worden als "—" getoond; er worden geen cijfers geschat.
          </p>
        </>
      )}
    </div>
  );
}

type VideoRow = {
  id: string; title: string; thumbnail_url: string | null; frame_url: string | null;
  duration_seconds: number | null; published_at: string | null; platforms: string | null;
  views: number; likes: number; comments: number; shares: number; saves: number;
  avg_watch: number | null; completion: number | null;
};

function platformList(s: string | null): string[] {
  return s ? s.split(",").filter(Boolean) : [];
}

function platChip(active: boolean): string {
  return `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
    active ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
  }`;
}

function VideoCard({ v }: { v: VideoRow }) {
  return (
    <Link href={`/analytics/video/${v.id}`} className="group overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] transition-shadow hover:shadow-[var(--shadow-raised)]">
      <VideoThumb src={v.thumbnail_url} title={v.title} ratio="aspect-[4/3]" />
      <div className="p-3">
        <div className="flex items-center gap-1.5">
          {platformList(v.platforms).map((p) => (
            <span key={p} className="size-2.5 rounded-full" style={{ background: PLATFORM[p]?.color ?? "#999" }} title={PLATFORM[p]?.label ?? p} />
          ))}
          {v.published_at ? <span className="ml-auto text-2xs text-[var(--color-ink-faint)]">{formatDate(String(v.published_at).slice(0, 10))}</span> : null}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.4em] text-sm font-medium group-hover:text-[var(--color-brand-600)]">{v.title}</p>
        <div className="mt-2 grid grid-cols-3 gap-1 text-center">
          <Metric label="Weergaven" value={compact(Number(v.views))} />
          <Metric label="Likes" value={compact(Number(v.likes))} />
          <Metric label="Uitkijk" value={v.completion != null ? `${Math.round(Number(v.completion) * 100)}%` : "—"} />
        </div>
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] py-1.5">
      <div className="text-sm font-bold tabular-nums leading-none">{value}</div>
      <div className="mt-0.5 text-2xs text-[var(--color-ink-faint)]">{label}</div>
    </div>
  );
}

function VideoList({ items }: { items: VideoRow[] }) {
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {items.map((v) => (
        <li key={v.id}>
          <Link href={`/analytics/video/${v.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-surface-2)]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{v.title}</span>
              {v.published_at ? <span className="block text-xs text-[var(--color-ink-faint)]">{formatDate(String(v.published_at).slice(0, 10))}</span> : null}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{compact(Number(v.views))}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
