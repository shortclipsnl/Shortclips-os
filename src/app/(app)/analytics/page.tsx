import type { Metadata } from "next";
import Link from "next/link";
import {
  sql,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  requirePermission,
} from "@/server/auth/context";
import { Avatar, Card, CardHeader, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { compact, formatDate, num } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";

export const metadata: Metadata = { title: "Resultaten" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ dagen?: string; klanten?: string; klant?: string }>;
}) {
  await requirePermission("analytics:read");
  const params = await searchParams;
  const days = Number(params.dagen) || 30;
  const klanten = params.klanten === "gestopt" ? "gestopt" : params.klanten === "alle" ? "alle" : "actief";
  const statusCond =
    klanten === "actief"
      ? sql`and c.status = 'active'`
      : klanten === "gestopt"
        ? sql`and c.status in ('paused','churned')`
        : sql``;
  const klantCond = params.klant ? sql`and c.slug = ${params.klant}` : sql``;

  const [totals, prevTotals, perClient, perPlatform, topVideos] = await Promise.all([
    db.execute(sql`
      select
        coalesce(sum(dm.views), 0)::int as views,
        coalesce(sum(dm.reach), 0)::int as reach,
        coalesce(sum(dm.engagements), 0)::int as engagements,
        coalesce(sum(dm.follower_delta), 0)::int as follower_growth,
        coalesce(sum(dm.posts_published), 0)::int as posts
      from daily_metrics dm
      join clients c on c.id = dm.client_id and c.deleted_at is null
      where dm.measured_on >= current_date - ${sql.raw(`interval '${days} days'`)} ${statusCond} ${klantCond}
    `),

    db.execute(sql`
      select
        coalesce(sum(dm.views), 0)::int as views,
        coalesce(sum(dm.reach), 0)::int as reach,
        coalesce(sum(dm.engagements), 0)::int as engagements,
        coalesce(sum(dm.follower_delta), 0)::int as follower_growth,
        coalesce(sum(dm.posts_published), 0)::int as posts
      from daily_metrics dm
      join clients c on c.id = dm.client_id and c.deleted_at is null
      where dm.measured_on >= current_date - ${sql.raw(`interval '${2 * days} days'`)}
        and dm.measured_on < current_date - ${sql.raw(`interval '${days} days'`)} ${statusCond} ${klantCond}
    `),

    db.execute(sql`
      select c.id, c.name, c.slug, c.color, c.status,
        coalesce(sum(dm.views), 0)::int as views,
        coalesce(sum(dm.reach), 0)::int as reach,
        coalesce(sum(dm.follower_delta), 0)::int as follower_growth
      from clients c
      left join daily_metrics dm
        on dm.client_id = c.id and dm.measured_on >= current_date - ${sql.raw(`interval '${days} days'`)}
      where c.deleted_at is null ${statusCond}
      group by c.id, c.name, c.slug, c.color, c.status
      order by views desc
    `),

    db.execute(sql`
      select dm.platform,
        coalesce(sum(dm.views), 0)::int as views,
        coalesce(sum(dm.reach), 0)::int as reach,
        coalesce(sum(dm.follower_delta), 0)::int as follower_growth
      from daily_metrics dm
      join clients c on c.id = dm.client_id and c.deleted_at is null
      where dm.measured_on >= current_date - ${sql.raw(`interval '${days} days'`)}
        and dm.platform is not null ${statusCond} ${klantCond}
      group by dm.platform
      order by views desc
    `),

    db.execute(sql`
      select d.id, d.title, c.name as client_name, c.slug as client_slug, c.color as client_color,
        d.published_at,
        max(sm.views)::int as views,
        max(sm.likes)::int as likes,
        max(sm.avg_watch_seconds) as avg_watch
      from deliverables d
      join clients c on c.id = d.client_id
      join publications p on p.deliverable_id = d.id
      join social_metrics sm on sm.publication_id = p.id
      where d.deleted_at is null and d.status = 'published'
        and d.published_at >= current_date - ${sql.raw(`interval '${days} days'`)} ${klantCond}
      group by d.id, d.title, c.name, c.slug, c.color, d.published_at
      order by views desc
      limit 15
    `),
  ]);

  const rows = <T,>(r: unknown): T[] =>
    ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

  const t = rows<Record<string, number>>(totals)[0] ?? {};
  const prev = rows<Record<string, number>>(prevTotals)[0] ?? {};
  const clientRows = rows<Record<string, string | number>>(perClient);
  const platformRows = rows<Record<string, string | number>>(perPlatform);
  const videoRows = rows<Record<string, string | number>>(topVideos);

  const deltaPct = (cur: number, p: number): number | null => (p > 0 ? Math.round(((cur - p) / p) * 100) : null);
  const deltaHint = (cur: number, p: number): string | undefined => {
    const d = deltaPct(cur, p);
    if (d === null) return undefined;
    return `${d >= 0 ? "+" : ""}${d}% vs vorige periode`;
  };
  const deltaTone = (cur: number, p: number): "good" | "bad" | undefined => {
    const d = deltaPct(cur, p);
    if (d === null) return undefined;
    return d >= 0 ? "good" : "bad";
  };
  const selectedName = params.klant ? String(clientRows.find((c) => String(c.slug) === params.klant)?.name ?? params.klant) : null;
  const keep = `dagen=${days}${klanten !== "actief" ? `&klanten=${klanten}` : ""}`;

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Resultaten"
        description={`${selectedName ?? (klanten === "gestopt" ? "Gestopte klanten" : klanten === "alle" ? "Alle klanten" : "Actieve klanten")}, afgelopen ${days} dagen · live uit Metricool`}
        actions={
          <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5">
            {[7, 30, 90].map((d) => (
              <Link
                key={d}
                href={`/analytics?dagen=${d}${klanten !== "actief" ? `&klanten=${klanten}` : ""}`}
                className={
                  days === d
                    ? "rounded-[4px] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
                    : "px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)]"
                }
              >
                {d} dagen
              </Link>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {([
          { key: "actief", label: "Actieve klanten" },
          { key: "gestopt", label: "Gestopte klanten" },
          { key: "alle", label: "Alle klanten" },
        ] as const).map((f) => (
          <Link
            key={f.key}
            href={`/analytics?dagen=${days}${f.key !== "actief" ? `&klanten=${f.key}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              klanten === f.key
                ? "bg-[var(--color-ink)] text-white"
                : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Klant-selectie: hele weergave inzoomen op één klant. */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href={`/analytics?${keep}`} className={chip(!params.klant)}>Alle klanten</Link>
        {clientRows.slice(0, 14).map((c) => (
          <Link key={String(c.id)} href={`/analytics?${keep}&klant=${c.slug}`} className={chip(params.klant === String(c.slug))}>
            {String(c.name)}
          </Link>
        ))}
      </div>

      <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-bold tracking-tight text-white">
        Belangrijkste resultaten · {selectedName ?? (klanten === "gestopt" ? "gestopte klanten" : klanten === "alle" ? "alle klanten" : "actieve klanten")}
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Weergaven" value={compact(Number(t.views ?? 0))} hint={deltaHint(Number(t.views ?? 0), Number(prev.views ?? 0))} tone={deltaTone(Number(t.views ?? 0), Number(prev.views ?? 0))} />
        <Stat label="Bereik" value={compact(Number(t.reach ?? 0))} hint={deltaHint(Number(t.reach ?? 0), Number(prev.reach ?? 0))} tone={deltaTone(Number(t.reach ?? 0), Number(prev.reach ?? 0))} />
        <Stat label="Interacties" value={compact(Number(t.engagements ?? 0))} hint={deltaHint(Number(t.engagements ?? 0), Number(prev.engagements ?? 0))} tone={deltaTone(Number(t.engagements ?? 0), Number(prev.engagements ?? 0))} />
        <Stat label="Volgersgroei" value={`${Number(t.follower_growth ?? 0) >= 0 ? "+" : ""}${num(Number(t.follower_growth ?? 0))}`} hint={deltaHint(Number(t.follower_growth ?? 0), Number(prev.follower_growth ?? 0))} tone={deltaTone(Number(t.follower_growth ?? 0), Number(prev.follower_growth ?? 0))} />
        <Stat label="Publicaties" value={num(Number(t.posts ?? 0))} hint={deltaHint(Number(t.posts ?? 0), Number(prev.posts ?? 0))} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Per klant" />
          </div>
          <Table
            head={
              <>
                <th className="sc-th">Klant</th>
                <th className="sc-th text-right">Weergaven</th>
                <th className="sc-th text-right">Bereik</th>
                <th className="sc-th text-right">Volgers</th>
              </>
            }
          >
            {clientRows.map((c) => (
              <tr key={String(c.id)} className="sc-row-link">
                <td className="sc-td">
                  <Link href={`/clients/${c.slug}`} className="flex items-center gap-2 hover:underline">
                    <Avatar name={String(c.name)} color={c.color ? String(c.color) : null} size={22} />
                    {String(c.name)}
                  </Link>
                </td>
                <td className="sc-td text-right tabular-nums">{compact(Number(c.views))}</td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                  {compact(Number(c.reach))}
                </td>
                <td className="sc-td text-right tabular-nums">+{num(Number(c.follower_growth))}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Per platform" />
          </div>
          {platformRows.length === 0 ? (
            <EmptyState title="Nog geen cijfers" />
          ) : (
            <Table
              head={
                <>
                  <th className="sc-th">Platform</th>
                  <th className="sc-th text-right">Weergaven</th>
                  <th className="sc-th text-right">Bereik</th>
                  <th className="sc-th text-right">Volgers</th>
                </>
              }
            >
              {platformRows.map((p) => (
                <tr key={String(p.platform)}>
                  <td className="sc-td">
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: PLATFORM[String(p.platform)]?.color ?? "#999" }}
                      />
                      {PLATFORM[String(p.platform)]?.label ?? String(p.platform)}
                    </span>
                  </td>
                  <td className="sc-td text-right tabular-nums">{compact(Number(p.views))}</td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                    {compact(Number(p.reach))}
                  </td>
                  <td className="sc-td text-right tabular-nums">+{num(Number(p.follower_growth))}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-5" padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Best presterende video's" subtitle={`Gepubliceerd in de afgelopen ${days} dagen`} />
        </div>
        {videoRows.length === 0 ? (
          <EmptyState title="Nog geen gepubliceerde video's in deze periode" />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Video</th>
                <th className="sc-th">Klant</th>
                <th className="sc-th">Gepubliceerd</th>
                <th className="sc-th text-right">Weergaven</th>
                <th className="sc-th text-right">Likes</th>
                <th className="sc-th text-right">Gem. kijktijd</th>
              </>
            }
          >
            {videoRows.map((v) => (
              <tr key={String(v.id)} className="sc-row-link">
                <td className="sc-td">
                  <Link href={`/videos/${v.id}`} className="font-medium hover:underline">
                    {String(v.title)}
                  </Link>
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">{String(v.client_name)}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {formatDate(String(v.published_at))}
                </td>
                <td className="sc-td text-right tabular-nums">{compact(Number(v.views))}</td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                  {compact(Number(v.likes))}
                </td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                  {v.avg_watch ? `${Number(v.avg_watch).toFixed(1)}s` : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        Cijfers komen uit dagelijkse snapshots in de eigen database. Weergaven en
        interacties zijn vrijwel actueel; bereik, kijktijd en retentie lopen bij
        de meeste platforms één tot drie dagen achter. Retentie en opslagacties
        zijn niet op elk platform via de API beschikbaar.
      </p>
    </div>
  );
}

function chip(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-medium ${
    active
      ? "bg-[var(--color-ink)] text-white"
      : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
  }`;
}
