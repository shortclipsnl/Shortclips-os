import { ArrowDownRight, ArrowUpRight, BarChart3, Bookmark, Clock, ExternalLink, Eye, Film, Heart, ListVideo, MessageSquare, Play, Sparkles, TrendingDown, Trophy, Users } from "lucide-react";
import { CountUp } from "@/components/portal/count-up";
import { compact, formatDate, num } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
import type { PortalResults, PortalTopVideo } from "@/server/portal";
import { ResultControls } from "./result-controls";
import { TrendChart } from "./trend-chart";
import { PlatformView } from "./platform-view";

function Delta({ pct, compact = false }: { pct: number | null; compact?: boolean }) {
  if (pct === null) return <span className={`text-[12px] text-[var(--color-ink-faint)] ${compact ? "" : "mt-1 block"}`}>—</span>;
  if (pct === 0) return <span className={`text-[12px] text-[var(--color-ink-faint)] ${compact ? "" : "mt-1 block"}`}>gelijk{compact ? "" : " aan vorige periode"}</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-semibold ${up ? "text-[#2fd27a]" : "text-[#ff8b6b]"} ${compact ? "" : "mt-1"}`}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct)}%{compact ? "" : <span className="font-normal text-[var(--color-ink-faint)]"> t.o.v. vorige periode</span>}
    </span>
  );
}

function StatBlock({ icon, label, value, prefix = "", pct }: { icon: React.ReactNode; label: string; value: number; prefix?: string; pct?: number | null }) {
  return (
    <div className="sc-glass p-5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
        <span className="text-[var(--sc-accent)]">{icon}</span> {label}
      </div>
      <CountUp value={value} prefix={prefix} className="mt-2 block text-[26px] font-bold tabular-nums leading-none" />
      {pct !== undefined ? <Delta pct={pct} /> : null}
    </div>
  );
}

/** Kijktijd leesbaar maken: seconden, of m:ss vanaf een minuut. */
function fmtWatch(s: number): string {
  if (s <= 0) return "0s";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Compact extra-statistiekblokje (likes, reacties, opslaan/delen, kijktijd). */
function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="sc-glass flex items-center gap-3 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(25,168,255,0.12)] text-[var(--sc-accent)]">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</div>
        <div className="text-[18px] font-bold tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}

function Thumb({ v, large = false }: { v: PortalTopVideo; large?: boolean }) {
  const dot = PLATFORM[v.platform]?.color ?? "#888";
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-[12px] border border-[var(--sc-line)] bg-gradient-to-br from-[#12224a] to-[#0a0c26] ${large ? "aspect-[9/16] w-28 sm:w-36" : "size-16"}`}>
      {v.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.thumbnailUrl} alt="" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center text-white/40"><Play className={large ? "size-7" : "size-5"} /></span>
      )}
      <span className="absolute bottom-1 left-1 size-2.5 rounded-full ring-1 ring-black/40" style={{ background: dot }} title={PLATFORM[v.platform]?.label ?? v.platform} />
    </div>
  );
}

const COMPARE_ROWS: Array<{ k: "views" | "reach" | "followerGrowth" | "publishedVideos"; label: string; invert?: boolean }> = [
  { k: "views", label: "Weergaven" },
  { k: "reach", label: "Bereik" },
  { k: "followerGrowth", label: "Nieuwe volgers" },
  { k: "publishedVideos", label: "Gepubliceerde video's" },
];

/**
 * De resultatenweergave van het klantportaal — gedeeld tussen het echte portaal
 * en de interne voorbeeldweergave (kantoorteam), zodat beide exact gelijk zijn.
 * `basePath` bepaalt waar de periodeknoppen en het PDF-rapport naartoe linken.
 */
export function PortalResultsView({ r, basePath, reportHref }: { r: PortalResults; basePath: string; reportHref: string }) {
  const periodLabel =
    r.periodKey === "custom"
      ? `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`
      : { "30": "Afgelopen 30 dagen", "90": "Afgelopen 3 maanden", "180": "Afgelopen 6 maanden", "365": "Afgelopen 12 maanden" }[r.periodKey] ?? `Afgelopen ${r.days} dagen`;

  const best = r.topVideos[0] ?? null;
  // Minst bekeken video van de periode (positief gebracht: om van te leren).
  const worst = r.allVideos.length > 1 ? r.allVideos[r.allVideos.length - 1]! : null;
  // Beste video per platform (alleen platforms waar we een topvideo van kennen).
  const platformBests = r.byPlatform.filter((p) => p.bestVideo);
  // Extra statistieken — alleen tonen wat er is.
  const extraStats = [
    { key: "likes", icon: <Heart className="size-4" />, label: "Likes", value: num(r.likes), has: r.likes > 0 },
    { key: "comments", icon: <MessageSquare className="size-4" />, label: "Reacties", value: num(r.comments), has: r.comments > 0 },
    { key: "saves", icon: <Bookmark className="size-4" />, label: "Opslaan & delen", value: num(r.valuableInteractions), has: r.valuableInteractions > 0 },
    { key: "watch", icon: <Clock className="size-4" />, label: "Gem. kijktijd", value: fmtWatch(r.avgWatchSeconds), has: r.avgWatchSeconds > 0 },
  ].filter((s) => s.has);

  return (
    <div className="flex flex-col gap-7">
      {/* Kop: periodelabel + periodefilter + PDF */}
      <div className="relative flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[25px] font-bold tracking-tight">Resultaten</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {periodLabel}
            {r.lastUpdated ? <span className="text-[var(--color-ink-faint)]"> · bijgewerkt op {formatDate(r.lastUpdated)}</span> : null}
          </p>
        </div>
        <ResultControls basePath={basePath} periodKey={r.periodKey} from={r.periodKey === "custom" ? r.periodStart : undefined} to={r.periodKey === "custom" ? r.periodEnd : undefined} reportHref={reportHref} />
      </div>

      {!r.hasData ? (
        <div className="sc-glass flex flex-col items-start gap-3 border-dashed p-6">
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--sc-fill)] text-[var(--sc-accent)]"><BarChart3 className="size-5" strokeWidth={1.75} /></span>
          <div>
            <p className="text-sm font-semibold">Nog geen resultaten voor deze periode</p>
            <p className="mt-1 max-w-xl text-sm text-[var(--color-ink-muted)]">
              Zodra je kanalen zijn gekoppeld en er in deze periode content live stond, verschijnen hier automatisch je weergaven,
              bereik, volgersgroei en best presterende video's. Je hoeft nu niets te doen.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Vier kernblokken */}
          <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
            <StatBlock icon={<Eye className="size-3.5" />} label="Weergaven" value={r.metrics.views} pct={r.deltas.views} />
            <StatBlock icon={<BarChart3 className="size-3.5" />} label="Bereik" value={r.metrics.reach} pct={r.deltas.reach} />
            <StatBlock icon={<Users className="size-3.5" />} label="Nieuwe volgers" value={r.metrics.followerGrowth} prefix={r.metrics.followerGrowth >= 0 ? "+" : ""} pct={r.deltas.followerGrowth} />
            <StatBlock icon={<Film className="size-3.5" />} label="Gepubliceerde video's" value={r.metrics.publishedVideos} pct={r.deltas.publishedVideos} />
          </div>

          {/* Extra statistieken — likes, reacties, opslaan & delen, gem. kijktijd */}
          {extraStats.length > 0 ? (
            <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
              {extraStats.map((s) => (
                <MiniStat key={s.key} icon={s.icon} label={s.label} value={s.value} />
              ))}
            </div>
          ) : null}

          {/* Mijlpaal (subtiel) */}
          {r.milestone?.reached ? (
            <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[#19a8ff]/30 bg-[rgba(25,168,255,0.07)] px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[rgba(25,168,255,0.16)] text-[#19a8ff]"><Trophy className="size-4" /></span>
              <div className="text-[13.5px]">
                <span className="font-semibold">Mijlpaal behaald: {compact(r.milestone.reached)} weergaven totaal.</span>
                {r.milestone.next ? <span className="text-[var(--color-ink-muted)]"> Nog {compact(r.milestone.next - r.milestone.lifetimeViews)} te gaan tot {compact(r.milestone.next)}.</span> : null}
              </div>
            </div>
          ) : null}

          {/* Ontwikkeling (grafiek) */}
          <TrendChart series={r.series} />

          {/* Per platform */}
          {r.byPlatform.length > 0 ? <PlatformView platforms={r.byPlatform} /> : null}

          {/* Beste video per platform — in één oogopslag de topper per kanaal */}
          {platformBests.length > 0 ? (
            <section className="sc-glass p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><Trophy className="size-4" /></span>
                <h2 className="text-base font-semibold">Beste video per platform</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {platformBests.map((p) => (
                  <div key={p.platform} className="rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-3.5">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: PLATFORM[p.platform]?.color ?? "#888" }} />
                      {PLATFORM[p.platform]?.label ?? p.platform}
                    </div>
                    <div className="mt-2 line-clamp-2 text-[13.5px] font-medium leading-snug">{p.bestVideo!.title}</div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-[var(--color-ink-muted)]">{num(p.bestVideo!.views)} weergaven</span>
                      {p.bestVideo!.url ? <a href={p.bestVideo!.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--sc-accent)] hover:underline">Bekijken <ExternalLink className="size-3.5" /></a> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Video van de maand + top 3 */}
          {best ? (
            <section className="sc-glass p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.16)] text-[#19a8ff]"><Trophy className="size-4" /></span>
                <h2 className="text-base font-semibold">Best presterende video</h2>
              </div>
              <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                <Thumb v={best} large />
                <div className="min-w-0 flex-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--sc-fill-strong)] px-2 py-0.5 text-[11px] font-medium">
                    <span className="size-2 rounded-full" style={{ background: PLATFORM[best.platform]?.color ?? "#888" }} /> {PLATFORM[best.platform]?.label ?? best.platform}
                  </span>
                  <h3 className="mt-2 text-[17px] font-semibold leading-snug">{best.title}</h3>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                    <div><div className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">Weergaven</div><div className="text-lg font-bold tabular-nums">{num(best.views)}</div></div>
                    {best.likes > 0 ? <div><div className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">Likes</div><div className="text-lg font-bold tabular-nums">{num(best.likes)}</div></div> : null}
                    {best.publishedAt ? <div><div className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">Geplaatst</div><div className="text-lg font-semibold">{formatDate(best.publishedAt)}</div></div> : null}
                  </div>
                  {best.url ? (
                    <a href={best.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] px-4 py-1.5 text-[13px] font-semibold text-white hover:opacity-90">
                      <Play className="size-4" /> Bekijk video
                    </a>
                  ) : null}
                </div>
              </div>

              {r.topVideos.length > 1 ? (
                <div className="mt-5 border-t border-[var(--sc-line)] pt-4">
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Top video's deze periode</p>
                  <ul className="flex flex-col gap-2">
                    {r.topVideos.map((v, i) => (
                      <li key={v.id} className="flex items-center gap-3">
                        <span className="w-5 shrink-0 text-center text-[13px] font-bold text-[var(--color-ink-faint)]">{i + 1}</span>
                        <Thumb v={v} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-semibold">{v.title}</div>
                          <div className="text-[12px] text-[var(--color-ink-muted)]">{PLATFORM[v.platform]?.label ?? v.platform} · {num(v.views)} weergaven{v.likes > 0 ? ` · ${num(v.likes)} likes` : ""}</div>
                        </div>
                        {v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--sc-accent)]"><ExternalLink className="size-4" /></a> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Minst bekeken video — eerlijk beeld, positief gebracht (om van te leren) */}
          {worst && best && worst.id !== best.id ? (
            <section className="sc-glass p-5">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-[var(--sc-fill-strong)] text-[var(--color-ink-muted)]"><TrendingDown className="size-4" /></span>
                <h2 className="text-base font-semibold">Minst bekeken video</h2>
              </div>
              <p className="mt-1 text-[12.5px] text-[var(--color-ink-muted)]">Handig om mee te nemen naar de volgende ronde: niet elke video scoort gelijk, en daar leren we van.</p>
              <div className="mt-4 flex items-center gap-4">
                <Thumb v={worst} />
                <div className="min-w-0 flex-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--sc-fill-strong)] px-2 py-0.5 text-[11px] font-medium">
                    <span className="size-2 rounded-full" style={{ background: PLATFORM[worst.platform]?.color ?? "#888" }} /> {PLATFORM[worst.platform]?.label ?? worst.platform}
                  </span>
                  <h3 className="mt-1.5 text-[15px] font-semibold leading-snug">{worst.title}</h3>
                  <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                    {num(worst.views)} weergaven{worst.likes > 0 ? ` · ${num(worst.likes)} likes` : ""}{worst.publishedAt ? ` · ${formatDate(worst.publishedAt)}` : ""}
                  </div>
                </div>
                {worst.url ? <a href={worst.url} target="_blank" rel="noreferrer" className="shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--sc-accent)]"><ExternalLink className="size-4" /></a> : null}
              </div>
            </section>
          ) : null}

          {/* Wat valt op */}
          {r.insights.length > 0 ? (
            <section className="sc-glass p-5 sm:p-6" style={{ background: "linear-gradient(180deg, rgba(25,168,255,0.07), rgba(255,255,255,0.02))" }}>
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><Sparkles className="size-4" /></span>
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

          {/* Vergelijking met vorige periode */}
          <section className="sc-glass overflow-hidden p-0">
            <div className="flex items-center justify-between gap-2 px-5 pt-5">
              <h2 className="text-base font-semibold">Vergeleken met de vorige periode</h2>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-[13.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                    <th className="px-5 py-2 font-medium">Statistiek</th>
                    <th className="px-5 py-2 text-right font-medium">Vorige periode</th>
                    <th className="px-5 py-2 text-right font-medium">Deze periode</th>
                    <th className="px-5 py-2 text-right font-medium">Verschil</th>
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

          {/* Alle video's met cijfers — volledige lijst over de periode */}
          {r.allVideos.length > 0 ? (
            <section className="sc-glass overflow-hidden p-0">
              <div className="flex items-center gap-2 px-5 pt-5">
                <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><ListVideo className="size-4" /></span>
                <h2 className="text-base font-semibold">Alle video&apos;s</h2>
                <span className="rounded-full bg-[var(--sc-fill-strong)] px-2 py-0.5 text-2xs font-bold text-[var(--color-ink-muted)]">{r.allVideos.length}</span>
              </div>
              <div className="mt-3 max-h-[520px] overflow-auto">
                <table className="w-full min-w-[520px] text-[13.5px]">
                  <thead className="sticky top-0 bg-[var(--color-surface)]">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                      <th className="px-5 py-2 font-medium">Video</th>
                      <th className="px-3 py-2 font-medium">Platform</th>
                      <th className="px-3 py-2 text-right font-medium">Weergaven</th>
                      <th className="px-3 py-2 text-right font-medium">Likes</th>
                      <th className="px-5 py-2 text-right font-medium">Geplaatst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.allVideos.map((v) => (
                      <tr key={v.id} className="border-t border-[var(--sc-line)]">
                        <td className="max-w-[260px] px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{v.title}</span>
                            {v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--sc-accent)]"><ExternalLink className="size-3.5" /></a> : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 shrink-0 rounded-full" style={{ background: PLATFORM[v.platform]?.color ?? "#888" }} />
                            <span className="text-[12.5px] text-[var(--color-ink-muted)]">{PLATFORM[v.platform]?.label ?? v.platform}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{num(v.views)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink-muted)]">{v.likes > 0 ? num(v.likes) : "—"}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-[var(--color-ink-muted)]">{v.publishedAt ? formatDate(v.publishedAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <p className="text-xs text-[var(--color-ink-faint)]">
            Cijfers komen automatisch uit je gekoppelde kanalen (via Metricool) en zijn gelijk aan wat je team intern ziet.
            Vergeleken met de voorgaande periode van dezelfde lengte.
          </p>
        </>
      )}
    </div>
  );
}
