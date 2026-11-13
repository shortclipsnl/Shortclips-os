import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, Monitor, Plug, Presentation, RefreshCw } from "lucide-react";
import { requirePermission } from "@/server/auth/context";
import { ClientLogo } from "@/components/ui";
import { compact, num } from "@/lib/format";
import { amsterdamToday, deltaPct, parsePeriodKey, PERIODS, rankByCategory, resolvePeriod, TOP_CATEGORIES, type PeriodKey } from "@/lib/resultaten-overzicht";
import { loadResultsOverview, type ClientResult } from "@/server/resultaten-overzicht";
import { TopVideos } from "./top-videos";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Resultaten" };
export const dynamic = "force-dynamic";

type Search = { periode?: string; koppeling?: string };

function href(cur: { periode: PeriodKey; koppeling?: string }, patch: Partial<{ periode: PeriodKey; koppeling: string }>) {
  const q = new URLSearchParams();
  const next = { ...cur, ...patch };
  if (next.periode !== "30") q.set("periode", next.periode);
  if (next.koppeling && next.koppeling !== "gekoppeld") q.set("koppeling", next.koppeling);
  const s = q.toString();
  return `/analytics${s ? `?${s}` : ""}`;
}

const tsFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });

/* --------------------------- Kleine bouwstenen --------------------------- */

function Sparkline({ values, width = 120, height = 32, stroke = "currentColor", fill }: { values: number[]; width?: number; height?: number; stroke?: string; fill?: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <svg width={width} height={height} aria-hidden><line x1="0" x2={width} y1={height - 1} y2={height - 1} stroke={stroke} strokeOpacity="0.25" strokeDasharray="3 3" /></svg>;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      {fill ? <path d={`${line} L${width},${height} L0,${height} Z`} fill={fill} /> : null}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Delta({ d, onDark = false }: { d: number | null; onDark?: boolean }) {
  if (d === null) return <span className={onDark ? "text-white/40" : "text-[var(--color-ink-faint)]"}>geen vergelijking</span>;
  const up = d >= 0;
  const color = onDark ? (up ? "#7ee0b0" : "#ffb1a8") : up ? "var(--color-good)" : "var(--color-bad)";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 font-semibold tabular-nums" style={{ color }}>
      <Icon className="size-3.5" strokeWidth={2.25} />
      {up ? "+" : ""}{d}%
    </span>
  );
}

function KpiTile({ label, value, delta, note, series, prevLabel }: {
  label: string; value: string; delta?: number | null; note?: string; series?: number[]; prevLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--radius-md)] bg-white/[0.06] p-3.5 ring-1 ring-white/10">
      <div className="text-2xs font-semibold uppercase tracking-wide text-white/60">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="text-2xl font-bold leading-none tabular-nums text-white">{value}</span>
        {series ? <span className="text-[#7fd3ff]"><Sparkline values={series} width={72} height={26} stroke="currentColor" fill="rgba(127,211,255,0.12)" /></span> : null}
      </div>
      <div className="mt-2 text-2xs leading-snug">
        {delta !== undefined ? (
          <><Delta d={delta} onDark /> <span className="text-white/50">t.o.v. {prevLabel}</span></>
        ) : (
          <span className="text-white/50">{note}</span>
        )}
      </div>
    </div>
  );
}

function MetricCell({ label, value, title }: { label: string; value: string | null; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="truncate text-2xs text-[var(--color-ink-faint)]">{label}</div>
      {value === null ? (
        <div className="text-2xs leading-tight text-[var(--color-ink-faint)]">Niet beschikbaar</div>
      ) : (
        <div className="text-sm font-semibold tabular-nums">{value}</div>
      )}
    </div>
  );
}

/** Opvallende prestatie: duidelijke groei of daling in weergaven. */
function signal(c: ClientResult): { label: string; tone: "good" | "bad" } | null {
  const d = deltaPct(c.viewsCompare, c.viewsPrev);
  if (d === null || c.viewsPrev < 500) return null;
  if (d >= 50) return { label: "Sterke groei", tone: "good" };
  if (d <= -40) return { label: "Daling", tone: "bad" };
  return null;
}

function ClientRow({ c, rank, prevLabel }: { c: ClientResult; rank: number; prevLabel: string }) {
  const dv = deltaPct(c.viewsCompare, c.viewsPrev);
  const sig = signal(c);
  return (
    <div className="grid grid-cols-3 items-center gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4 lg:grid-cols-[minmax(240px,2.4fr)_repeat(7,minmax(62px,0.8fr))_80px_auto]">
      <Link href={`/analytics/${c.slug}`} className="col-span-full flex min-w-0 items-center gap-2.5 lg:col-span-1" title={`Alle resultaten van ${c.name}`}>
        {rank <= 3 ? (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-indigo-ink)] text-2xs font-bold text-white">{rank}</span>
        ) : (
          <span className="w-5 shrink-0 text-center text-2xs font-semibold tabular-nums text-[var(--color-ink-faint)]">{rank}</span>
        )}
        <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={30} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold hover:underline" title={c.name}>{c.name}</span>
          {sig ? (
            <span className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-2xs font-semibold ${sig.tone === "good" ? "bg-[var(--color-good)]/12 text-[var(--color-good)]" : "bg-[var(--color-bad)]/12 text-[var(--color-bad)]"}`}>{sig.label}</span>
          ) : null}
        </span>
      </Link>
      <div className="min-w-0">
        <div className="text-2xs text-[var(--color-ink-faint)]" title={c.viewsFromPosts ? "Dit account levert geen dagweergaven; geteld zijn de video's uit deze periode" : undefined}>Weergaven{c.viewsFromPosts ? " *" : ""}</div>
        <div className="text-sm font-semibold tabular-nums">{compact(c.views)}</div>
        {dv === null ? null : <div className="text-2xs leading-tight" title={`t.o.v. ${prevLabel}`}><Delta d={dv} /></div>}
      </div>
      <MetricCell label="Bereik" value={c.reachAvailable ? compact(c.reach) : null} title={c.reachAvailable ? undefined : "Dit account levert (nog) geen bereik via Metricool"} />
      <MetricCell label="Likes" value={compact(c.likes)} title="Likes op posts uit deze periode" />
      <MetricCell label="Reacties" value={compact(c.comments)} title="Reacties op posts uit deze periode" />
      <MetricCell label="Opgeslagen" value={c.saves === null ? null : compact(c.saves)} title={c.saves === null ? "Alleen Instagram levert opslagen; geen Instagram-posts in deze periode" : "Opgeslagen (Instagram) op posts uit deze periode"} />
      <div className="min-w-0">
        <div className="text-2xs text-[var(--color-ink-faint)]">Volgers</div>
        <div className="text-sm font-semibold tabular-nums" style={{ color: c.followers > 0 ? "var(--color-good)" : c.followers < 0 ? "var(--color-bad)" : undefined }}>
          {c.followers >= 0 ? "+" : ""}{num(c.followers)}
        </div>
      </div>
      <MetricCell label="Video's" value={num(c.videos)} title="Gepubliceerde video's in deze periode" />
      <span className="hidden text-[var(--color-brand-500)] lg:block" title="Weergaven per dag in deze periode">
        <Sparkline values={c.series} width={80} height={28} />
      </span>
      <Link
        href={`/analytics/${c.slug}`}
        className="col-span-full inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 lg:col-span-1"
      >
        Bekijk resultaten <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

/* --------------------------------- Pagina -------------------------------- */

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission("analytics:read");
  const params = await searchParams;
  const periode = parsePeriodKey(params.periode);
  const period = resolvePeriod(periode, amsterdamToday());
  const linkFilter: "gekoppeld" | "niet" | "alle" =
    params.koppeling === "niet" ? "niet" : params.koppeling === "alle" ? "alle" : "gekoppeld";
  const cur = { periode, koppeling: linkFilter };

  const data = await loadResultsOverview(period);
  const { totals } = data;
  const linked = data.clients.filter((c) => c.linked);
  const toLink = data.clients.filter((c) => !c.linked);
  const tileClients = linkFilter === "gekoppeld" ? linked : linkFilter === "niet" ? toLink : data.clients;

  // Top 12 per categorie (zonder dubbelen); de client-component kiest daaruit.
  const cardIds = new Set<string>();
  const cards = TOP_CATEGORIES.flatMap((c) => rankByCategory(data.videos, c.key, 12))
    .filter((c) => (cardIds.has(c.id) ? false : (cardIds.add(c.id), true)));

  const hasAnyData = linked.length > 0;
  const prevLabel = period.prevLabel;

  return (
    <div className="mx-auto max-w-[1300px]">
      <AutoRefresh />

      {/* Kop + periodekeuze */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Resultaten</h1>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
            <RefreshCw className="size-3" />
            {data.lastUpdated ? `Laatst bijgewerkt ${tsFmt.format(new Date(data.lastUpdated))}` : "Nog geen metingen ontvangen"}
            <span className="text-[var(--color-ink-faint)]">· ververst automatisch</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="inline-flex flex-wrap rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5" aria-label="Periode">
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={href(cur, { periode: p.key })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${p.key === periode ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
                aria-current={p.key === periode ? "page" : undefined}
              >
                {p.label}
              </Link>
            ))}
          </nav>
          <Link
            href={`/resultaten-presentatie${periode !== "30" ? `?periode=${periode}` : ""}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-indigo-ink)] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
            title="Open de resultaten als presentatie voor een groot scherm of tv"
          >
            <Presentation className="size-3.5" /> Presentatiemodus
          </Link>
          <a
            href="/scherm"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            title="Open het resultatenscherm voor het grote scherm op kantoor"
          >
            <Monitor className="size-3.5" /> Kantoorscherm
          </a>
        </div>
      </div>

      {/* 1. Totaalresultaten */}
      <section className="mb-5 rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] p-4 text-white sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold tracking-tight">Totaal van alle klanten</h2>
          <span className="text-xs text-white/60">
            {period.label} · {linked.length} gekoppelde klanten · vergeleken met {prevLabel}
          </span>
        </div>
        {hasAnyData ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-7">
            <KpiTile label="Weergaven" value={compact(totals.views)} delta={deltaPct(totals.viewsCompare, totals.viewsPrev)} series={totals.series} prevLabel={prevLabel} />
            <KpiTile label="Bereik" value={compact(totals.reach)} delta={deltaPct(totals.reachCompare, totals.reachPrev)} prevLabel={prevLabel} />
            <KpiTile label="Likes" value={compact(totals.likes)} note={`op ${num(totals.posts)} posts uit deze periode`} prevLabel={prevLabel} />
            <KpiTile label="Reacties" value={compact(totals.comments)} note={`op ${num(totals.posts)} posts uit deze periode`} prevLabel={prevLabel} />
            <KpiTile label="Opgeslagen" value={totals.saves === null ? "Niet beschikbaar" : compact(totals.saves)} note="alleen Instagram levert opslagen" prevLabel={prevLabel} />
            <KpiTile label="Volgersgroei" value={`${totals.followers >= 0 ? "+" : ""}${num(totals.followers)}`} delta={deltaPct(totals.followers, totals.followersPrev)} prevLabel={prevLabel} />
            <KpiTile label="Gepubliceerde video's" value={num(totals.videos)} delta={deltaPct(totals.videos, totals.videosPrev)} prevLabel={prevLabel} />
          </div>
        ) : (
          <p className="rounded-[var(--radius-md)] bg-white/[0.06] px-4 py-6 text-center text-sm text-white/70">
            Nog geen resultaten. Zodra klanten aan Metricool gekoppeld zijn en er cijfers binnenkomen, verschijnen ze hier.
          </p>
        )}
      </section>

      {/* 2. Inklapbaar klantenoverzicht */}
      <section className="mb-5">
        <p className="mb-2 text-sm font-medium text-[var(--color-ink)]">Klik op een onderstaande klant om de specifieke resultaten te bekijken.</p>
        <details className="group rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]" open={params.koppeling ? true : undefined}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              Bekijk alle klanten
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            </span>
            <span className="flex items-center gap-2 text-2xs">
              <span className="rounded-full bg-[var(--color-good)]/12 px-2 py-0.5 font-semibold text-[var(--color-good)]">{linked.length} gekoppeld</span>
              {toLink.length ? <span className="rounded-full bg-[var(--color-bad)]/12 px-2 py-0.5 font-semibold text-[var(--color-bad)]">{toLink.length} nog te koppelen</span> : null}
            </span>
          </summary>
          <div className="border-t border-[var(--color-line)] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Tonen:</span>
              <Link href={href(cur, { koppeling: "gekoppeld" })} className={linkTab(linkFilter === "gekoppeld")}>
                <span className="size-1.5 rounded-full bg-[var(--color-good)]" /> Gekoppeld <span className="opacity-70">· {linked.length}</span>
              </Link>
              <Link href={href(cur, { koppeling: "alle" })} className={linkTab(linkFilter === "alle")}>Alle klanten <span className="opacity-70">· {data.clients.length}</span></Link>
              <Link href={href(cur, { koppeling: "niet" })} className={linkTab(linkFilter === "niet")}>
                <span className="size-1.5 rounded-full bg-[var(--color-line-strong)]" /> Niet gekoppeld <span className="opacity-70">· {toLink.length}</span>
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {tileClients.length === 0 ? (
                <p className="col-span-full rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-6 text-center text-sm text-[var(--color-ink-faint)]">Geen klanten in deze selectie.</p>
              ) : null}
              {tileClients.map((c) => (
                <Link
                  key={c.slug}
                  href={`/analytics/${c.slug}`}
                  className="group/tile flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-line)] px-3 py-2.5 transition hover:border-[var(--color-brand-500)] hover:shadow-[var(--shadow-raised)]"
                  title={`Alle resultaten van ${c.name}`}
                >
                  <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold leading-tight group-hover/tile:text-[var(--color-brand-700)]">{c.name}</span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-2xs font-medium">
                      <span className="size-1.5 rounded-full" style={{ background: c.linked ? "var(--color-good)" : "var(--color-line-strong)" }} />
                      <span className={c.linked ? "text-[var(--color-good)]" : "text-[var(--color-ink-faint)]"}>{c.linked ? `${compact(c.views)} weergaven` : "geen koppeling"}</span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>

            {toLink.length > 0 && linkFilter !== "niet" ? (
              <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-bad)]/35 bg-[var(--color-bad-soft)]/40 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0 text-[var(--color-bad)]" strokeWidth={2} />
                  <span className="text-sm font-semibold text-[var(--color-bad)]">Nog te koppelen klanten</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {toLink.map((c) => (
                    <Link key={c.slug} href={`/clients/${c.slug}/edit`} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-bad)]/30 bg-[var(--color-surface)] py-1 pl-1 pr-2.5 text-xs font-medium hover:border-[var(--color-bad)]" title={`Koppeling instellen voor ${c.name}`}>
                      <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={20} />
                      {c.name}
                      <Plug className="size-3 text-[var(--color-bad)]" />
                    </Link>
                  ))}
                </div>
                <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Zodra een klant resultaten uit Metricool binnenkrijgt, verschuift die automatisch naar de gekoppelde klanten.</p>
              </div>
            ) : null}
          </div>
        </details>
      </section>

      {/* 3. Best presterende video's */}
      {hasAnyData ? <TopVideos cards={cards} periodLabel={period.label} /> : null}

      {/* 4. Resultaten per klant */}
      {hasAnyData ? (
        <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
            <h2 className="text-base font-semibold tracking-tight">Resultaten per klant</h2>
            <span className="text-xs text-[var(--color-ink-muted)]">{period.label} · gesorteerd op weergaven · percentage t.o.v. {prevLabel}</span>
          </div>
          <div className="divide-y divide-[var(--color-line)]">
            {linked.map((c, i) => <ClientRow key={c.id} c={c} rank={i + 1} prevLabel={prevLabel} />)}
          </div>
        </section>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-[var(--color-ink-muted)]">
        Alle cijfers komen uit de dagelijkse Metricool-metingen in de eigen database en worden elke nacht en elke ochtend bijgewerkt.
        Weergaven, bereik en volgersgroei zijn dagcijfers per account over de gekozen periode (* levert een account geen dagweergaven, zoals sommige TikTok-accounts, dan tellen de video&apos;s uit de periode en telt die klant niet mee in het percentage); bereik en kijktijd lopen bij de
        meeste platforms één tot drie dagen achter. Likes, reacties en opgeslagen tellen per post die in de periode is gepubliceerd
        (laatste meting). Opgeslagen is alleen via Instagram beschikbaar; Facebook levert geen bereik per video.
      </p>
    </div>
  );
}

function linkTab(active: boolean): string {
  return `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
    active ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
  }`;
}
