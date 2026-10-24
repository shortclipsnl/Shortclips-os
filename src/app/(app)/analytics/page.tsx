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
import { compact, num } from "@/lib/format";

export const metadata: Metadata = { title: "Resultaten" };
export const dynamic = "force-dynamic";

// De tabellen (per klant, per platform, beste video's) tonen we over een vaste,
// representatieve periode van 30 dagen. De kerncijfers bovenin tonen we juist
// voor 7 én 30 dagen tegelijk, zodat je niet hoeft te wisselen.
const TABLE_DAYS = 30;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ klant?: string; koppeling?: string }>;
}) {
  await requirePermission("analytics:read");
  const params = await searchParams;
  // Standaard tonen we alleen gekoppelde klanten — dan zie je meteen echte
  // resultaten en niet een lijst vol lege klanten. "Alle" is een bewuste keuze.
  const linkFilter: "gekoppeld" | "niet" | "alle" =
    params.koppeling === "niet" ? "niet" : params.koppeling === "alle" ? "alle" : "gekoppeld";

  // Alleen actieve, échte klanten — gestopte klanten en records die geen klant
  // van ons zijn (show_in_results = false) tonen we hier bewust niet.
  const statusCond = sql`and c.status = 'active' and c.show_in_results = true`;
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

  // Aantal gepubliceerde video's (deze periode) over alle getoonde klanten —
  // als extra kerncijfer bij het totaal.
  const videosQuery = (fromDays: number, toDays: number | null) =>
    db.execute(sql`
      select count(*)::int as videos
      from deliverables d
      join clients c on c.id = d.client_id and c.deleted_at is null
      where d.deleted_at is null and d.status = 'published'
        and d.published_at >= current_date - ${sql.raw(`interval '${fromDays} days'`)}
        ${toDays !== null ? sql`and d.published_at < current_date - ${sql.raw(`interval '${toDays} days'`)}` : sql``}
        ${statusCond} ${klantCond}
    `);

  const [cur7, prev7, cur30, prev30, vid7, vid30, perClient] = await Promise.all([
    totalsQuery(7, null),
    totalsQuery(14, 7),
    totalsQuery(30, null),
    totalsQuery(60, 30),
    videosQuery(7, null),
    videosQuery(30, null),

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
  ]);

  const rows = <T,>(r: unknown): T[] =>
    ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

  const t7 = rows<Record<string, number>>(cur7)[0] ?? {};
  const p7 = rows<Record<string, number>>(prev7)[0] ?? {};
  const t30 = rows<Record<string, number>>(cur30)[0] ?? {};
  const p30 = rows<Record<string, number>>(prev30)[0] ?? {};
  const clientRows = rows<Record<string, string | number>>(perClient);
  const v7 = Number(rows<Record<string, number>>(vid7)[0]?.videos ?? 0);
  const v30 = Number(rows<Record<string, number>>(vid30)[0]?.videos ?? 0);
  // Gepubliceerde video's als kerncijfer meenemen (in dezelfde totaal-objecten).
  (t7 as Record<string, number>).videos = v7;
  (t30 as Record<string, number>).videos = v30;
  // Klant-tegels (logo's naast elkaar) komen uit dezelfde lijst: gekoppelde
  // klanten eerst, dan op weergaven.
  const allTiles = clientRows.map((c) => ({
    slug: String(c.slug),
    name: String(c.name),
    color: c.color ? String(c.color) : null,
    logoUrl: c.logoUrl ? String(c.logoUrl) : null,
    linked: Number(c.linked) === 1,
  }));
  const linkedCount = allTiles.filter((c) => c.linked).length;
  const tileClients = linkFilter === "gekoppeld"
    ? allTiles.filter((c) => c.linked)
    : linkFilter === "niet"
      ? allTiles.filter((c) => !c.linked)
      : allTiles;

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
    { key: "videos", label: "Gepubliceerde video's", fmt: (n) => num(n) },
    { key: "posts", label: "Publicaties", fmt: (n) => num(n) },
  ];

  // Eén groot kerncijfer: 30 dagen als hoofdgetal (groot), 7 dagen eronder als
  // tweede regel. Het verschilpercentage staat bij de periode waarvoor het telt.
  const bigMetric = (m: (typeof METRICS)[number]) => {
    const c30 = Number(t30[m.key] ?? 0);
    const c7 = Number(t7[m.key] ?? 0);
    const d30 = deltaPct(c30, Number(p30[m.key] ?? 0));
    const d7 = deltaPct(c7, Number(p7[m.key] ?? 0));
    const tone30 = m.tone ? deltaTone(c30, Number(p30[m.key] ?? 0)) : undefined;
    const Delta = ({ d, tone }: { d: number | null; tone?: "good" | "bad" }) =>
      d === null ? <span className="text-[var(--color-ink-faint)]">—</span> : (
        <span className="font-semibold" style={{ color: tone === "good" ? "var(--color-good)" : tone === "bad" ? "var(--color-bad)" : "var(--color-ink-faint)" }}>{d >= 0 ? "+" : ""}{d}%</span>
      );
    return (
      <div key={m.key} className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">{m.label}</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums leading-none">{m.fmt(c30)}</span>
          <span className="text-2xs font-medium text-[var(--color-ink-faint)]">30 dagen</span>
        </div>
        <div className="mt-1 text-2xs"><Delta d={d30} tone={tone30} /> <span className="text-[var(--color-ink-faint)]">t.o.v. vorige 30 dagen</span></div>
        <div className="mt-2 flex items-baseline justify-between border-t border-[var(--color-line)] pt-2 text-xs">
          <span className="text-[var(--color-ink-muted)]">7 dagen: <span className="font-semibold tabular-nums text-[var(--color-ink)]">{m.fmt(c7)}</span></span>
          <span className="text-2xs"><Delta d={d7} tone={m.tone ? deltaTone(c7, Number(p7[m.key] ?? 0)) : undefined} /></span>
        </div>
      </div>
    );
  };

  const kpiCards = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {METRICS.map((m) => bigMetric(m))}
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
      {/* Filter op koppeling: standaard alleen gekoppelde klanten (echte resultaten). */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Tonen:</span>
        <Link href="/analytics?koppeling=gekoppeld" className={linkTab(linkFilter === "gekoppeld")}>
          <span className="size-1.5 rounded-full bg-[var(--color-good)]" /> Gekoppeld <span className="opacity-70">· {linkedCount}</span>
        </Link>
        <Link href="/analytics?koppeling=alle" className={linkTab(linkFilter === "alle")}>Alle klanten <span className="opacity-70">· {allTiles.length}</span></Link>
        <Link href="/analytics?koppeling=niet" className={linkTab(linkFilter === "niet")}>
          <span className="size-1.5 rounded-full bg-[var(--color-line-strong)]" /> Niet gekoppeld <span className="opacity-70">· {allTiles.length - linkedCount}</span>
        </Link>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {tileClients.length === 0 ? (
          <p className="col-span-full rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-6 text-center text-sm text-[var(--color-ink-faint)]">Geen klanten in deze selectie.</p>
        ) : null}
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
          {/* Kerncijfers: het totaal, opgeteld over alle getoonde klanten. Per
              cijfer het grote 30-daagse totaal + 7 dagen eronder. */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-3 text-white">
            <span className="text-base font-bold tracking-tight">Totaal — {selectedName ?? `alle ${allTiles.length} klanten samen`}</span>
            <span className="text-xs text-white/70">Opgeteld over 7 én 30 dagen</span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-[var(--color-ink-muted)]">
            {selectedName
              ? "Alle cijfers van deze klant, "
              : `Alle cijfers van de ${allTiles.length} getoonde klanten bij elkaar opgeteld, `}
            uit de dagelijkse Metricool-snapshots in de eigen database. Het <strong>grote getal</strong> is de laatste
            30 dagen; het percentage eronder vergelijkt met de 30 dagen daarvoor. De tweede regel toont dezelfde periode over 7 dagen.
          </p>
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

function linkTab(active: boolean): string {
  return `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
    active ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
  }`;
}
