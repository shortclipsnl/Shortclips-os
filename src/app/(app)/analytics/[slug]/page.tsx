import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePermission, assertClientAccess } from "@/server/auth/context";
import { Card, CardHeader, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { compact, formatDate, num } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";

export const metadata: Metadata = { title: "Klantresultaten" };
export const dynamic = "force-dynamic";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

export default async function ClientResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ dagen?: string }>;
}) {
  const viewer = await requirePermission("analytics:read");
  const { slug } = await params;
  const days = Number((await searchParams).dagen) || 90;

  const [client] = await db.select({ id: clients.id, name: clients.name, color: clients.color, quota: clients.monthlyVideoQuota }).from(clients).where(and(eq(clients.slug, slug), isNull(clients.deletedAt))).limit(1);
  if (!client) notFound();
  assertClientAccess(viewer, client.id);
  const cid = client.id;

  const dInt = `interval '${days} days'`;
  const [totals, perMonth, perPlatform, topVideos, bottomVideos, publishedRow] = await Promise.all([
    db.execute(sql`
      select coalesce(sum(views),0)::int views, coalesce(sum(reach),0)::int reach, coalesce(sum(engagements),0)::int engagements,
             coalesce(sum(follower_delta),0)::int follower_growth, coalesce(sum(shares),0)::int shares, coalesce(sum(saves),0)::int saves,
             coalesce(sum(posts_published),0)::int posts
      from daily_metrics where client_id = ${cid} and measured_on >= current_date - ${sql.raw(dInt)}`),
    db.execute(sql`
      select to_char(measured_on,'YYYY-MM') maand, coalesce(sum(views),0)::int views, coalesce(sum(follower_delta),0)::int volgers
      from daily_metrics where client_id = ${cid} and measured_on >= current_date - interval '12 months'
      group by 1 order by 1`),
    db.execute(sql`
      select platform, coalesce(sum(views),0)::int views, coalesce(sum(reach),0)::int reach, coalesce(sum(follower_delta),0)::int volgers
      from daily_metrics where client_id = ${cid} and platform is not null and measured_on >= current_date - ${sql.raw(dInt)}
      group by 1 order by 2 desc`),
    db.execute(sql`
      select d.id, d.title, d.published_at, max(sm.views)::int views, max(sm.likes)::int likes
      from deliverables d join publications p on p.deliverable_id = d.id join social_metrics sm on sm.publication_id = p.id
      where d.client_id = ${cid} and d.deleted_at is null and d.status = 'published'
      group by d.id, d.title, d.published_at order by views desc limit 5`),
    db.execute(sql`
      select d.id, d.title, d.published_at, max(sm.views)::int views
      from deliverables d join publications p on p.deliverable_id = d.id join social_metrics sm on sm.publication_id = p.id
      where d.client_id = ${cid} and d.deleted_at is null and d.status = 'published'
      group by d.id, d.title, d.published_at order by views asc limit 5`),
    db.execute(sql`select count(*)::int n from deliverables where client_id = ${cid} and deleted_at is null and status = 'published'`),
  ]);

  const t = rows<Record<string, number>>(totals)[0] ?? {};
  const months = rows<Record<string, string | number>>(perMonth);
  const platforms = rows<Record<string, string | number>>(perPlatform);
  const top = rows<Record<string, string | number>>(topVideos);
  const bottom = rows<Record<string, string | number>>(bottomVideos);
  const publishedTotal = Number(rows<Record<string, number>>(publishedRow)[0]?.n ?? 0);
  const avgViews = publishedTotal > 0 ? Math.round(Number(t.views ?? 0) / publishedTotal) : 0;
  const maxMonth = Math.max(1, ...months.map((m) => Number(m.views)));

  const hasData = Number(t.views ?? 0) > 0 || months.length > 0;

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href="/analytics" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← Resultaten</Link>
      <PageHeader
        title={client.name}
        description={`Volledige resultaten · afgelopen ${days} dagen · live uit Metricool`}
        actions={
          <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5">
            {[30, 90, 365].map((d) => (
              <Link key={d} href={`/analytics/${slug}?dagen=${d}`} className={days === d ? "rounded-[4px] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white" : "px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)]"}>
                {d === 365 ? "1 jaar" : `${d} dagen`}
              </Link>
            ))}
          </div>
        }
      />

      {!hasData ? (
        <Card><EmptyState title="Nog geen resultaten" description="Zodra Metricool cijfers voor deze klant levert, verschijnen ze hier." /></Card>
      ) : (
        <>
          <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-bold tracking-tight text-white">Overzicht</div>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Gepubliceerde video's" value={num(publishedTotal)} />
            <Stat label="Weergaven" value={compact(Number(t.views ?? 0))} />
            <Stat label="Bereik" value={compact(Number(t.reach ?? 0))} />
            <Stat label="Gem. per video" value={compact(avgViews)} />
            <Stat label="Nieuwe volgers" value={`${Number(t.follower_growth ?? 0) >= 0 ? "+" : ""}${num(Number(t.follower_growth ?? 0))}`} />
            <Stat label="Interacties" value={compact(Number(t.engagements ?? 0))} hint={`${num(Number(t.shares ?? 0))} shares · ${num(Number(t.saves ?? 0))} saves`} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
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

            {/* Best presterend */}
            <Card padded={false}>
              <CardHeader title="Best presterende video's" className="p-5 pb-2" />
              {top.length === 0 ? <EmptyState title="Nog geen gepubliceerde video's" /> : <VideoList items={top} metric />}
            </Card>

            {/* Minst presterend */}
            <Card padded={false}>
              <CardHeader title="Minst presterende video's" className="p-5 pb-2" />
              {bottom.length === 0 ? <EmptyState title="Nog geen data" /> : <VideoList items={bottom} metric />}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function VideoList({ items, metric }: { items: Record<string, string | number>[]; metric?: boolean }) {
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {items.map((v) => (
        <li key={String(v.id)}>
          <Link href={`/videos/${v.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-[var(--color-surface-2)]">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{String(v.title)}</span>
              {v.published_at ? <span className="block text-xs text-[var(--color-ink-faint)]">{formatDate(String(v.published_at).slice(0, 10))}</span> : null}
            </span>
            {metric ? <span className="shrink-0 text-sm font-semibold tabular-nums">{compact(Number(v.views))}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
