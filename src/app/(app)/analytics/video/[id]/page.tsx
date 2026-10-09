import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { db } from "@/db/client";
import { clients, deliverables } from "@/db/schema";
import { requirePermission, assertClientAccess } from "@/server/auth/context";
import { Card, CardHeader, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { compact, formatDate, num } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
import { VideoThumb } from "../../video-thumb";

export const metadata: Metadata = { title: "Video-analyse" };
export const dynamic = "force-dynamic";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

type PubRow = {
  id: string; platform: string; external_url: string | null; published_at: string | null;
  views: number | null; reach: number | null; likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; profile_visits: number | null;
  avg_watch: number | null; completion: number | null;
};

export default async function VideoAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requirePermission("analytics:read");
  const { id } = await params;

  const [video] = await db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      status: deliverables.status,
      thumbnailUrl: deliverables.thumbnailUrl,
      frameUrl: deliverables.frameUrl,
      publishedAt: deliverables.publishedAt,
      durationSeconds: deliverables.durationSeconds,
      clientId: deliverables.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .where(and(eq(deliverables.id, id), isNull(deliverables.deletedAt)))
    .limit(1);
  if (!video) notFound();
  assertClientAccess(viewer, video.clientId);

  const [pubRes, seriesRes, retentionRes] = await Promise.all([
    db.execute(sql`
      with pm as (
        select publication_id, max(views) views, max(reach) reach, max(likes) likes, max(comments) comments,
               max(shares) shares, max(saves) saves, max(profile_visits) profile_visits,
               max(avg_watch_seconds) avg_watch, max(completion_rate) completion
        from social_metrics
        where publication_id in (select id from publications where deliverable_id = ${id} and deleted_at is null)
        group by publication_id
      )
      select p.id, p.platform::text platform, p.external_url, p.published_at,
             pm.views, pm.reach, pm.likes, pm.comments, pm.shares, pm.saves, pm.profile_visits, pm.avg_watch, pm.completion
      from publications p left join pm on pm.publication_id = p.id
      where p.deliverable_id = ${id} and p.deleted_at is null
      order by pm.views desc nulls last`),
    db.execute(sql`
      select measured_on, sum(views)::int views
      from social_metrics
      where publication_id in (select id from publications where deliverable_id = ${id} and deleted_at is null)
      group by measured_on order by measured_on`),
    db.execute(sql`
      select retention_curve from social_metrics
      where publication_id in (select id from publications where deliverable_id = ${id} and deleted_at is null)
        and retention_curve is not null
      order by measured_on desc limit 1`),
  ]);

  const pubs = rows<PubRow>(pubRes);
  const series = rows<Record<string, string | number>>(seriesRes);
  const retention = parseRetention(rows<{ retention_curve: unknown }>(retentionRes)[0]?.retention_curve);

  const sum = (k: keyof PubRow) => pubs.reduce((a, p) => a + Number(p[k] ?? 0), 0);
  const totalViews = sum("views");
  const watchVals = pubs.map((p) => (p.avg_watch == null ? null : Number(p.avg_watch))).filter((x): x is number => x != null);
  const compVals = pubs.map((p) => (p.completion == null ? null : Number(p.completion))).filter((x): x is number => x != null);
  const avgWatch = watchVals.length ? watchVals.reduce((a, b) => a + b, 0) / watchVals.length : null;
  const completion = compVals.length ? compVals.reduce((a, b) => a + b, 0) / compVals.length : null;

  const maxSeries = Math.max(1, ...series.map((s) => Number(s.views)));
  const hasData = totalViews > 0 || pubs.some((p) => p.views != null);

  return (
    <div className="mx-auto max-w-[1000px]">
      <Link href={`/analytics/${video.clientSlug}`} className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← {video.clientName}</Link>
      <PageHeader
        title={video.title}
        description={`${video.clientName}${video.publishedAt ? ` · gepubliceerd ${formatDate(video.publishedAt)}` : ""}${video.durationSeconds ? ` · ${video.durationSeconds}s` : ""}`}
      />

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)]">
            <VideoThumb src={video.thumbnailUrl} title={video.title} ratio="aspect-[9/16]" />
          </div>
          <div className="space-y-1.5">
            {pubs.filter((p) => p.external_url).map((p) => (
              <a key={p.id} href={p.external_url!} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: PLATFORM[p.platform]?.color ?? "#999" }} />
                  Bekijk op {PLATFORM[p.platform]?.label ?? p.platform}
                </span>
                <ExternalLink className="size-3.5 text-[var(--color-ink-faint)]" />
              </a>
            ))}
            {video.frameUrl ? (
              <a href={video.frameUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]">
                <span>Frame.io</span><ExternalLink className="size-3.5 text-[var(--color-ink-faint)]" />
              </a>
            ) : null}
            {pubs.every((p) => !p.external_url) && !video.frameUrl ? (
              <p className="text-xs text-[var(--color-ink-faint)]">Geen externe videolink beschikbaar.</p>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          {!hasData ? (
            <Card><EmptyState title="Nog geen cijfers" description="Zodra Metricool metrics voor deze video levert, verschijnen ze hier." /></Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Weergaven" value={compact(totalViews)} />
                <Stat label="Bereik" value={compact(sum("reach"))} />
                <Stat label="Likes" value={compact(sum("likes"))} />
                <Stat label="Reacties" value={compact(sum("comments"))} />
                <Stat label="Shares" value={compact(sum("shares"))} />
                <Stat label="Saves" value={compact(sum("saves"))} />
                <Stat label="Gem. kijktijd" value={avgWatch != null ? `${avgWatch.toFixed(1)}s` : "—"} hint={avgWatch == null ? "niet beschikbaar" : undefined} />
                <Stat label="Uitkijkpercentage" value={completion != null ? `${Math.round(completion * 100)}%` : "—"} hint={completion == null ? "niet beschikbaar" : undefined} />
              </div>

              <Card padded={false}>
                <CardHeader title="Per platform" className="p-5 pb-2" />
                <Table head={<><th className="sc-th">Platform</th><th className="sc-th text-right">Weergaven</th><th className="sc-th text-right">Likes</th><th className="sc-th text-right">Reacties</th><th className="sc-th text-right">Shares</th><th className="sc-th text-right">Saves</th><th className="sc-th text-right">Uitkijk</th></>}>
                  {pubs.map((p) => (
                    <tr key={p.id}>
                      <td className="sc-td"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: PLATFORM[p.platform]?.color ?? "#999" }} />{PLATFORM[p.platform]?.label ?? p.platform}</span></td>
                      <td className="sc-td text-right tabular-nums">{p.views != null ? compact(Number(p.views)) : "—"}</td>
                      <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{p.likes != null ? compact(Number(p.likes)) : "—"}</td>
                      <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{p.comments != null ? compact(Number(p.comments)) : "—"}</td>
                      <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{p.shares != null ? compact(Number(p.shares)) : "—"}</td>
                      <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{p.saves != null ? compact(Number(p.saves)) : "—"}</td>
                      <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{p.completion != null ? `${Math.round(Number(p.completion) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </Table>
              </Card>

              {series.length > 1 ? (
                <Card padded={false}>
                  <CardHeader title="Ontwikkeling van de weergaven" className="p-5 pb-2" />
                  <div className="flex items-end gap-1 overflow-x-auto px-5 pb-5 pt-2" style={{ height: 140 }}>
                    {series.map((s) => (
                      <div key={String(s.measured_on)} className="flex min-w-6 flex-1 flex-col items-center justify-end gap-1" title={`${formatDate(String(s.measured_on))}: ${num(Number(s.views))}`}>
                        <span className="w-full rounded-t-[3px] bg-[var(--color-brand-600)]" style={{ height: `${Math.max(2, (Number(s.views) / maxSeries) * 100)}%` }} />
                        <span className="text-2xs text-[var(--color-ink-faint)]">{String(s.measured_on).slice(5)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              <Card padded={false}>
                <CardHeader title="Retentiegrafiek" subtitle="Hoeveel kijkers er nog kijken gedurende de video" className="p-5 pb-2" />
                {retention.length === 0 ? (
                  <div className="px-5 pb-5"><p className="text-sm text-[var(--color-ink-muted)]">Niet beschikbaar voor dit platform.</p></div>
                ) : (
                  <div className="flex items-end gap-0.5 px-5 pb-5 pt-2" style={{ height: 120 }}>
                    {retention.map((r, i) => (
                      <span key={i} className="flex-1 rounded-t-[2px] bg-[var(--color-indigo-ink)]" style={{ height: `${Math.max(2, r)}%` }} title={`${Math.round((i / Math.max(1, retention.length - 1)) * 100)}%: ${Math.round(r)}% kijkt nog`} />
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Zet een opgeslagen retentiecurve (jsonb) om naar een reeks percentages 0–100. */
function parseRetention(raw: unknown): number[] {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const nums = arr
    .map((e) => {
      if (typeof e === "number") return e;
      if (e && typeof e === "object") {
        const o = e as Record<string, unknown>;
        const v = o.pct ?? o.value ?? o.retention ?? o.y;
        return typeof v === "number" ? v : null;
      }
      return null;
    })
    .filter((x): x is number => x != null);
  if (nums.length === 0) return [];
  // Normaliseer naar percentages: fracties (0–1) → ×100.
  const max = Math.max(...nums);
  return max <= 1 ? nums.map((n) => n * 100) : nums;
}
