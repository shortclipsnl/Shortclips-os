import type { Metadata } from "next";
import Link from "next/link";
import {
  sql,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  requirePermission,
} from "@/server/auth/context";
import { Monitor, MousePointerClick } from "lucide-react";
import { Card, CardHeader, ClientLogo, EmptyState, PageHeader, Table } from "@/components/ui";
import { compact, formatDate, num } from "@/lib/format";

export const metadata: Metadata = { title: "Resultaten" };
export const dynamic = "force-dynamic";

// De tabellen (per klant, per platform, beste video's) tonen we over een vaste,
// representatieve periode van 30 dagen. De kerncijfers bovenin tonen we juist
// voor 7 én 30 dagen tegelijk, zodat je niet hoeft te wisselen.
const TABLE_DAYS = 30;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ klant?: string }>;
}) {
  await requirePermission("analytics:read");
  const params = await searchParams;

  // Alleen actieve klanten — gestopte klanten tonen we hier bewust niet.
  const statusCond = sql`and c.status = 'active'`;
  const klantCond = params.klant ? sql`and c.slug = ${params.klant}` : sql``;

  // Kerncijfers voor een venster [fromDays terug .. toDays terug). toDays=null = tot nu.
  const totalsQuery = (fromDays: number, toDays: number | null) =>
    db.execute(sql`
      select
        coalesce(sum(dm.views), 0)::int as views,
        coalesce(sum(dm.reach), 0)::int as reach,
        coalesce(sum(dm.engagements), 0)::int as engagements,
        coalesce(sum(dm.follower_delta), 0)::int as follower_growth,
        coalesce(sum(dm.posts_published), 0)::int as posts
      from daily_metrics dm
      join clients c on c.id = dm.client_id and c.deleted_at is null
      where dm.measured_on >= current_date - ${sql.raw(`interval '${fromDays} days'`)}
        ${toDays !== null ? sql`and dm.measured_on < current_date - ${sql.raw(`interval '${toDays} days'`)}` : sql``}
        ${statusCond} ${klantCond}
    `);

  const [cur7, prev7, cur30, prev30, perClient, topVideos] = await Promise.all([
    totalsQuery(7, null),
    totalsQuery(14, 7),
    totalsQuery(30, null),
    totalsQuery(60, 30),

    db.execute(sql`
      select c.id, c.name, c.slug, c.color, c.status, c.logo_url as "logoUrl",
        coalesce(sum(dm.views), 0)::int as views,
        coalesce(sum(dm.reach), 0)::int as reach,
        coalesce(sum(dm.follower_delta), 0)::int as follower_growth,
        (exists (select 1 from daily_metrics d2 where d2.client_id = c.id))::int as linked
      from clients c
      left join daily_metrics dm
        on dm.client_id = c.id and dm.measured_on >= current_date - ${sql.raw(`interval '${TABLE_DAYS} days'`)}
      where c.deleted_at is null ${statusCond}
      group by c.id, c.name, c.slug, c.color, c.status, c.logo_url
      order by (exists (select 1 from daily_metrics d2 where d2.client_id = c.id)) desc, views desc
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
        and d.published_at >= current_date - ${sql.raw(`interval '${TABLE_DAYS} days'`)} ${klantCond}
      group by d.id, d.title, c.name, c.slug, c.color, d.published_at
      order by views desc
      limit 15
    `),
  ]);

  const rows = <T,>(r: unknown): T[] =>
    ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

  const t7 = rows<Record<string, number>>(cur7)[0] ?? {};
  const p7 = rows<Record<string, number>>(prev7)[0] ?? {};
  const t30 = rows<Record<string, number>>(cur30)[0] ?? {};
  const p30 = rows<Record<string, number>>(prev30)[0] ?? {};
  const clientRows = rows<Record<string, string | number>>(perClient);
  const videoRows = rows<Record<string, string | number>>(topVideos);
  // Klant-tegels (logo's naast elkaar) komen uit dezelfde lijst: gekoppelde
  // klanten eerst, dan op weergaven.
  const tileClients = clientRows.map((c) => ({
    slug: String(c.slug),
    name: String(c.name),
    color: c.color ? String(c.color) : null,
    logoUrl: c.logoUrl ? String(c.logoUrl) : null,
    linked: Number(c.linked) === 1,
  }));

  const deltaPct = (cur: number, p: number): number | null => (p > 0 ? Math.round(((cur - p) / p) * 100) : null);
  const deltaTone = (cur: number, p: number): "good" | "bad" | undefined => {
    const d = deltaPct(cur, p);
    if (d === null) return undefined;
    return d >= 0 ? "good" : "bad";
  };
  const selectedName = params.klant ? String(clientRows.find((c) => String(c.slug) === params.klant)?.name ?? params.klant) : null;

  // De vijf kerncijfers; elk tegeltje toont 7 én 30 dagen naast elkaar, zodat
  // je in één oogopslag beide periodes ziet zonder te wisselen.
  const METRICS: { key: string; label: string; fmt: (n: number) => string; signed?: boolean; tone?: boolean }[] = [
    { key: "views", label: "Weergaven", fmt: (n) => compact(n), tone: true },
    { key: "reach", label: "Bereik", fmt: (n) => compact(n), tone: true },
    { key: "engagements", label: "Interacties", fmt: (n) => compact(n), tone: true },
    { key: "follower_growth", label: "Volgersgroei", fmt: (n) => `${n >= 0 ? "+" : ""}${num(n)}`, tone: true },
    { key: "posts", label: "Publicaties", fmt: (n) => num(n) },
  ];

  const period = (t: Record<string, number>, p: Record<string, number>, m: (typeof METRICS)[number], periodLabel: string) => {
    const cur = Number(t[m.key] ?? 0);
    const prev = Number(p[m.key] ?? 0);
    const d = deltaPct(cur, prev);
    const tone = m.tone ? deltaTone(cur, prev) : undefined;
    return (
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">{periodLabel}</div>
        <div className="text-xl font-bold tabular-nums leading-tight">{m.fmt(cur)}</div>
        {d !== null ? (
          <div className="text-2xs font-semibold" style={{ color: tone === "good" ? "var(--color-good)" : tone === "bad" ? "var(--color-bad)" : "var(--color-ink-faint)" }}>
            {d >= 0 ? "+" : ""}{d}%
          </div>
        ) : <div className="text-2xs text-[var(--color-ink-faint)]">—</div>}
      </div>
    );
  };

  const kpiCards = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {METRICS.map((m) => (
        <div key={m.key} className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5">
          <div className="mb-2 text-sm font-semibold">{m.label}</div>
          <div className="flex gap-3">
            {period(t7, p7, m, "7 dagen")}
            <div className="w-px bg-[var(--color-line)]" />
            {period(t30, p30, m, "30 dagen")}
          </div>
        </div>
      ))}
    </div>
  );

  const sum = (t: Record<string, number>) =>
    Number(t.views ?? 0) + Number(t.reach ?? 0) + Number(t.engagements ?? 0) + Math.abs(Number(t.follower_growth ?? 0)) + Number(t.posts ?? 0);
  const hasAnyData = sum(t7) + sum(t30) > 0;

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Resultaten"
        description={`${selectedName ?? "Alle actieve klanten samen"} · uit je eigen database (dagelijkse snapshots)`}
        actions={
          <a
            href="/scherm"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            title="Open het resultatenscherm voor het grote scherm op kantoor"
          >
            <Monitor className="size-4" /> Kantoorscherm
          </a>
        }
      />

      {/* Klant-tegels: logo's naast elkaar met bedrijfsnaam, groot en klikbaar —
          makkelijk aan te wijzen op een scherm. Klik opent alle resultaten van
          die klant. Gekoppelde klanten eerst. */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {tileClients.map((c) => (
          <Link
            key={c.slug}
            href={`/analytics/${c.slug}`}
            className="group flex items-center gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 transition hover:border-[var(--color-brand-500)] hover:shadow-[var(--shadow-raised)]"
            title={`Alle resultaten van ${c.name}`}
          >
            <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight group-hover:text-[var(--color-brand-700)]">{c.name}</span>
              <span className="mt-0.5 inline-flex items-center gap-1 text-2xs font-medium">
                <span className="size-1.5 rounded-full" style={{ background: c.linked ? "var(--color-good)" : "var(--color-line-strong)" }} />
                <span className={c.linked ? "text-[var(--color-good)]" : "text-[var(--color-ink-faint)]"}>{c.linked ? "Metricool" : "geen koppeling"}</span>
              </span>
            </span>
          </Link>
        ))}
      </div>

      <div className="mb-5 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[var(--color-info-soft)]/60 px-4 py-2.5 text-sm text-[var(--color-ink)]">
        <MousePointerClick className="mt-0.5 size-4 shrink-0 text-[var(--color-info)]" strokeWidth={1.75} />
        <p>
          Klik op een <strong>klantlogo hierboven</strong> om álle resultaten van die klant te zien — per video en per periode.
        </p>
      </div>

      {!hasAnyData ? (
        <Card padded={false}>
          <EmptyState
            title="Nog geen resultaten"
            description="Zodra klanten aan Metricool gekoppeld zijn en er cijfers binnenkomen, verschijnen de weergaven, het bereik en de best presterende video's hier."
          />
        </Card>
      ) : (
        <>
          {/* Kerncijfers: per cijfer 7 én 30 dagen naast elkaar — in één oogopslag. */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
            <span className="text-sm font-bold tracking-tight">Kerncijfers</span>
            <span className="text-xs text-white/70">7 én 30 dagen · {selectedName ?? "alle actieve klanten samen"}</span>
          </div>
          <div className="mb-6">{kpiCards}</div>

          <div className="grid gap-5">
            <Card padded={false}>
              <div className="p-5 pb-3">
                <CardHeader title="Per klant" subtitle="Afgelopen 30 dagen · klik op een klantnaam voor alle resultaten van die klant" />
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
                {clientRows.map((c, i) => {
                  const fg = Number(c.follower_growth);
                  const linked = Number(c.linked) === 1;
                  return (
                    <tr key={String(c.id)} className="sc-row-link" style={i < 3 && linked ? { boxShadow: "inset 3px 0 0 var(--color-brand-500)" } : undefined}>
                      <td className="sc-td">
                        <Link href={`/analytics/${c.slug}`} className="flex items-center gap-2 hover:underline">
                          {i < 3 && linked ? <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-brand-500)] text-2xs font-bold text-white">{i + 1}</span> : <span className="w-5 shrink-0" />}
                          <ClientLogo name={String(c.name)} logoUrl={c.logoUrl ? String(c.logoUrl) : null} color={c.color ? String(c.color) : null} size={22} />
                          {String(c.name)}
                        </Link>
                      </td>
                      {linked ? (
                        <>
                          <td className="sc-td text-right font-semibold tabular-nums">{compact(Number(c.views))}</td>
                          <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{compact(Number(c.reach))}</td>
                          <td className="sc-td text-right tabular-nums font-medium" style={{ color: fg > 0 ? "var(--color-good)" : fg < 0 ? "var(--color-bad)" : "var(--color-ink-muted)" }}>{fg >= 0 ? "+" : ""}{num(fg)}</td>
                        </>
                      ) : (
                        <td className="sc-td text-right text-xs text-[var(--color-ink-faint)]" colSpan={3}>niet gekoppeld</td>
                      )}
                    </tr>
                  );
                })}
              </Table>
            </Card>
          </div>

          <Card className="mt-5" padded={false}>
            <div className="p-5 pb-3">
              <CardHeader title="Best presterende video's" subtitle={`Gepubliceerd in de afgelopen ${TABLE_DAYS} dagen`} />
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
        </>
      )}
    </div>
  );
}
