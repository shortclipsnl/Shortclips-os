import { ArrowDownRight, ArrowUpRight, BarChart3, Bookmark, Clock, Eye, Film, Heart, MessageSquare, Share2, Sparkles, Trophy, Users } from "lucide-react";
import { CountUp } from "@/components/portal/count-up";
import { compact, formatDate, num } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
import type { PortalResults } from "@/server/portal";
import { ResultControls } from "./result-controls";
import { TrendChart } from "./trend-chart";
import { PlatformView } from "./platform-view";
import { VideoResults } from "./video-results";

/** Groei/daling t.o.v. de vorige periode; alleen als er echt vergelijkbare data is. */
function Delta({ pct, compact = false }: { pct: number | null; compact?: boolean }) {
  if (pct === null) return compact ? <span className="text-[12px] text-[var(--color-ink-faint)]">–</span> : null;
  if (pct === 0) return <span className={`text-[12px] text-[var(--color-ink-faint)] ${compact ? "" : "mt-1.5 block"}`}>gelijk{compact ? "" : " aan vorige periode"}</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-semibold ${up ? "text-[var(--st-green)]" : "text-[var(--st-red)]"} ${compact ? "" : "mt-1.5"}`}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct)}%{compact ? "" : <span className="font-normal text-[var(--color-ink-faint)]">&nbsp;t.o.v. vorige periode</span>}
    </span>
  );
}

/** Groot kerncijfer. */
function Kpi({ icon, label, value, prefix = "", pct, hero = false }: { icon: React.ReactNode; label: string; value: number; prefix?: string; pct?: number | null; hero?: boolean }) {
  return (
    <div className={`sc-glass p-5 ${hero ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        <span className="text-[var(--sc-accent)]">{icon}</span> {label}
      </div>
      <CountUp value={value} prefix={prefix} className={`mt-2.5 block font-bold tabular-nums leading-none tracking-tight ${hero ? "text-[40px]" : "text-[30px]"}`} />
      {pct !== undefined ? <Delta pct={pct} /> : null}
    </div>
  );
}

function fmtWatch(s: number): string {
  if (s <= 0) return "0s";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const COMPARE_ROWS: Array<{ k: "views" | "reach" | "followerGrowth" | "publishedVideos"; label: string }> = [
  { k: "views", label: "Weergaven" },
  { k: "reach", label: "Bereik" },
  { k: "followerGrowth", label: "Nieuwe volgers" },
  { k: "publishedVideos", label: "Geplaatste posts" },
];

const PERIOD_LABEL: Record<string, string> = {
  "30": "Afgelopen 30 dagen",
  "90": "Afgelopen 3 maanden",
  "180": "Afgelopen 6 maanden",
  "365": "Afgelopen 12 maanden",
  maand: "Deze maand",
  vorigemaand: "Vorige maand",
};

/**
 * De resultatenweergave van het klantportaal, gedeeld met de interne
 * voorbeeldweergave. Volgorde: kerncijfers → resultaten per video → verloop →
 * per platform → vergelijking. Alleen echte cijfers uit de koppelingen.
 */
export function PortalResultsView({ r, basePath, reportHref }: { r: PortalResults; basePath: string; reportHref: string }) {
  const periodLabel =
    r.periodKey === "custom"
      ? `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`
      : `${PERIOD_LABEL[r.periodKey] ?? `Afgelopen ${r.days} dagen`}${r.periodKey === "maand" || r.periodKey === "vorigemaand" ? ` (${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)})` : ""}`;

  // Kanalen met cijfers vs. kanalen waarop we publiceren zonder (nog) gekoppelde cijfers.
  const withData = new Set(r.byPlatform.map((p) => p.platform));
  for (const v of r.allVideos) withData.add(v.platform);
  const notLinked = r.plannedPlatforms.filter((p) => !withData.has(p));

  const secondary = [
    { key: "likes", icon: <Heart className="size-4" />, label: "Likes", value: num(r.likes), has: r.likes > 0 },
    { key: "comments", icon: <MessageSquare className="size-4" />, label: "Reacties", value: num(r.comments), has: r.comments > 0 },
    { key: "saves", icon: <Share2 className="size-4" />, label: "Shares & opgeslagen", value: num(r.valuableInteractions), has: r.valuableInteractions > 0 },
    { key: "watch", icon: <Clock className="size-4" />, label: "Gem. kijktijd", value: fmtWatch(r.avgWatchSeconds), has: r.avgWatchSeconds > 0 },
  ].filter((s) => s.has);

  return (
    <div className="flex flex-col gap-7">
      <div className="relative flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Resultaten</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {periodLabel}
            {r.lastUpdated ? <span className="text-[var(--color-ink-faint)]"> · bijgewerkt op {formatDate(r.lastUpdated)}</span> : null}
          </p>
        </div>
        <ResultControls basePath={basePath} periodKey={r.periodKey} from={r.periodKey === "custom" ? r.periodStart : undefined} to={r.periodKey === "custom" ? r.periodEnd : undefined} reportHref={reportHref} />
      </div>

      {/* Welke kanalen leveren cijfers, welke (nog) niet */}
      {withData.size > 0 || notLinked.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-[var(--color-ink-muted)]">Kanalen:</span>
          {[...withData].map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-green-bg)] px-2.5 py-1 font-medium text-[var(--st-green)]">
              <span className="size-1.5 rounded-full bg-[var(--st-green)]" /> {PLATFORM[p]?.label ?? p}
            </span>
          ))}
          {notLinked.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-grey-bg)] px-2.5 py-1 font-medium text-[var(--st-grey)]" title="Op dit kanaal publiceren we, maar de cijfers zijn nog niet gekoppeld.">
              <span className="size-1.5 rounded-full bg-[var(--st-grey)]" /> {PLATFORM[p]?.label ?? p} · nog niet gekoppeld
            </span>
          ))}
        </div>
      ) : null}

      {!r.hasData ? (
        <div className="sc-glass flex flex-col items-start gap-3 border-dashed p-6">
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--sc-fill)] text-[var(--sc-accent)]"><BarChart3 className="size-5" strokeWidth={1.75} /></span>
          <div>
            <p className="text-sm font-semibold">Nog geen resultaten voor deze periode</p>
            <p className="mt-1 max-w-xl text-sm text-[var(--color-ink-muted)]">
              Zodra je kanalen zijn gekoppeld en er in deze periode content live stond, verschijnen hier automatisch je weergaven, bereik, volgersgroei en de cijfers per video.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Kerncijfers */}
          <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-5">
            <Kpi hero icon={<Eye className="size-4" />} label="Totale weergaven" value={r.metrics.views} pct={r.deltas.views} />
            <Kpi icon={<BarChart3 className="size-4" />} label="Bereik" value={r.metrics.reach} pct={r.deltas.reach} />
            <Kpi icon={<Users className="size-4" />} label="Nieuwe volgers" value={r.metrics.followerGrowth} prefix={r.metrics.followerGrowth > 0 ? "+" : ""} pct={r.deltas.followerGrowth} />
            <Kpi icon={<Film className="size-4" />} label="Posts geplaatst" value={r.metrics.publishedVideos} pct={r.deltas.publishedVideos} />
          </div>
          {secondary.length > 0 ? (
            <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
              {secondary.map((s) => (
                <div key={s.key} className="sc-glass flex items-center gap-3 p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--st-blue-bg)] text-[var(--st-blue)]">{s.icon}</span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{s.label}</div>
                    <div className="text-[20px] font-bold tabular-nums leading-tight">{s.value}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {r.milestone?.reached ? (
            <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[var(--sc-line)] bg-[var(--st-green-bg)] px-4 py-3">
              <Trophy className="size-5 shrink-0 text-[var(--st-green)]" />
              <div className="text-[13.5px]">
                <span className="font-semibold">Mijlpaal: {compact(r.milestone.reached)} weergaven in totaal.</span>
                {r.milestone.next ? <span className="text-[var(--color-ink-muted)]"> Nog {compact(r.milestone.next - r.milestone.lifetimeViews)} tot {compact(r.milestone.next)}.</span> : null}
              </div>
            </div>
          ) : null}

          {/* Resultaten per video (belangrijkste onderdeel) */}
          {r.allVideos.length > 0 ? (
            <VideoResults videos={r.allVideos} />
          ) : (
            <section className="sc-glass p-5 text-[13.5px] text-[var(--color-ink-muted)]">
              <span className="font-semibold text-[var(--color-ink)]">Resultaten per video</span> · voor deze periode zijn (nog) geen cijfers per video beschikbaar via de gekoppelde kanalen. De totalen hierboven zijn wel compleet.
            </section>
          )}

          <TrendChart series={r.series} />

          {r.byPlatform.length > 0 ? <PlatformView platforms={r.byPlatform} /> : null}

          {r.insights.length > 0 ? (
            <section className="sc-glass p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-[var(--st-blue-bg)] text-[var(--st-blue)]"><Sparkles className="size-4" /></span>
                <h2 className="text-base font-semibold">Wat valt op?</h2>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {r.insights.map((t, i) => (
                  <li key={i} className="flex gap-2.5 text-[14px] text-[var(--color-ink-muted)]">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--sc-accent)]" /> {t}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="sc-glass overflow-hidden p-0">
            <div className="px-5 pt-5">
              <h2 className="text-base font-semibold">Vergeleken met de vorige periode</h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">Een percentage tonen we alleen als er over de vorige periode genoeg gegevens zijn.</p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-[13.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                    <th className="px-5 py-2 font-semibold">Statistiek</th>
                    <th className="px-5 py-2 text-right font-semibold">Vorige periode</th>
                    <th className="px-5 py-2 text-right font-semibold">Deze periode</th>
                    <th className="px-5 py-2 text-right font-semibold">Verschil</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row) => (
                    <tr key={row.k} className="border-t border-[var(--sc-line)]">
                      <td className="px-5 py-2.5 font-medium">{row.label}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-[var(--color-ink-muted)]">{num(r.prev[row.k])}</td>
                      <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{num(r.metrics[row.k])}</td>
                      <td className="px-5 py-2.5 text-right"><Delta pct={r.deltas[row.k]} compact /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
            <Bookmark className="size-3.5" /> Cijfers komen automatisch uit je gekoppelde kanalen (via Metricool) en zijn gelijk aan wat je team intern ziet.
          </p>
        </>
      )}
    </div>
  );
}
