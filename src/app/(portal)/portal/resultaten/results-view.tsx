import { ArrowDownRight, ArrowUpRight, BarChart3, Bookmark, Clock, Eye, Film, Heart, MessageSquare, Share2, Trophy, Users } from "lucide-react";
import { CountUp } from "@/components/portal/count-up";
import { compact, formatDate, num } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
import type { PortalResults } from "@/server/portal";
import type { PeriodReview } from "@/server/period-review";
import { capitalize, describePeriod, periodOptions, portalPeriodQuery } from "@/lib/portal-periods";
import { ResultControls } from "./result-controls";
import { AnalysisLinks, BusinessImpact, DirectieDownloads, KwartaalRapportLink, ManagementSummary, NextAdvice, QuarterMonths, WhatWorks } from "./period-sections";
import { ResultsExplorer } from "./results-explorer";
import { buildHighlights } from "./highlights";
import { WatValtOp } from "./wat-valt-op";

/** Groei/daling t.o.v. de vorige periode; alleen als er echt vergelijkbare data is. */
function Delta({ pct, compact = false, versus = "vorige periode" }: { pct: number | null; compact?: boolean; versus?: string }) {
  if (pct === null) return compact ? <span className="text-[12px] text-[var(--color-ink-faint)]">–</span> : null;
  if (pct === 0) return <span className={`text-[12px] text-[var(--color-ink-faint)] ${compact ? "" : "mt-1.5 block"}`}>gelijk{compact ? "" : ` aan ${versus}`}</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-semibold ${up ? "text-[var(--st-green)]" : "text-[var(--st-red)]"} ${compact ? "" : "mt-1.5"}`}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct)}%{compact ? "" : <span className="font-normal text-[var(--color-ink-faint)]">&nbsp;t.o.v. {versus}</span>}
    </span>
  );
}

/** Groot kerncijfer. */
function Kpi({ icon, label, value, prefix = "", pct, hero = false, versus }: { icon: React.ReactNode; label: string; value: number; prefix?: string; pct?: number | null; hero?: boolean; versus?: string }) {
  return (
    <div className={`sc-glass p-5 ${hero ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        <span className="text-[var(--sc-accent)]">{icon}</span> {label}
      </div>
      <CountUp value={value} prefix={prefix} className={`mt-2.5 block font-bold tabular-nums leading-none tracking-tight ${hero ? "text-[40px]" : "text-[30px]"}`} />
      {pct !== undefined ? <Delta pct={pct} versus={versus} /> : null}
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

/**
 * De resultatenweergave van het klantportaal, gedeeld met de interne
 * voorbeeldweergave. Volgorde: maandresultaten en kerncijfers → mijlpaal →
 * best presterende video's → resultaten per platform → resultaten per video →
 * wat valt op → vergelijking. Alleen echte cijfers uit de koppelingen.
 */
export function PortalResultsView({
  r,
  review = null,
  summaryText = "",
  basePath,
  pdfHref,
  monthlyPdfHref = null,
  directie = false,
  kwartaalRapport,
  shareHref,
  analysisHref,
  initialPlatform = "alle",
}: {
  r: PortalResults;
  /** Periodeoverzicht (samenvatting, wat werkt, impact, advies). */
  review?: PeriodReview | null;
  /** De managementsamenvatting als platte tekst (voor de kopieerknop). */
  summaryText?: string;
  basePath: string;
  /** PDF-route voor de gekozen periode (zonder query). */
  pdfHref: string;
  /** PDF van de gecontroleerde maandrapportage, als die voor deze maand is gepubliceerd. */
  monthlyPdfHref?: string | null;
  /** De klant mag de directieversie van deze maand zien (afgerond, gecontroleerd en gepubliceerd). */
  directie?: boolean;
  /**
   * Gepubliceerde kwartaalrapportage bij het gekozen kwartaal. null = nog niet
   * gepubliceerd; undefined = niet tonen (weergave zonder kwartaalrapportages).
   */
  kwartaalRapport?: { id: string; periodKey: string; nieuw: boolean } | null;
  /** Rapport op het scherm (zonder query), voor de deelknop. */
  shareHref: string;
  /** Link naar een maandanalyse. */
  analysisHref?: (id: string) => string;
  initialPlatform?: string;
}) {
  const period = describePeriod(r.periodKey, r.periodStart, r.periodEnd);
  const isQuarter = period.mode === "kwartaal";
  const options = periodOptions(r.firstDataOn);
  const query = portalPeriodQuery({ key: r.periodKey, from: r.periodStart, to: r.periodEnd });
  const running = period.mode !== "vrij" && !period.complete;
  // Waarmee vergelijken we? Een lopende maand zetten we af tegen dezelfde dagen van de vorige maand.
  const versus = period.prevLabel ? (running ? `dezelfde dagen in ${period.prevLabel}` : period.prevLabel) : "de vorige periode";
  const versusShort = period.prevLabel ?? "vorige periode";
  const periodLabel = `${capitalize(period.label)}${period.key !== "custom" ? ` (${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)})` : ""}${running ? " · loopt nog" : ""}`;
  const download = isQuarter
    ? { href: `${pdfHref}?${query}`, label: "Download kwartaaloverzicht", filename: `Shortclips_Kwartaaloverzicht_${r.periodKey}.pdf` }
    : period.mode === "maand" && monthlyPdfHref
      ? { href: monthlyPdfHref, label: "Download maandrapportage", filename: `Shortclips_Maandrapportage_${r.periodKey}.pdf` }
      : { href: `${pdfHref}?${query}`, label: period.mode === "maand" ? "Download maandoverzicht" : "Download rapport", filename: `Shortclips_Resultaten_${r.periodKey}.pdf` };

  // Per kanaal: levert cijfers, gekoppeld maar stil, of (nog) niet gekoppeld.
  const withData = r.platforms.filter((p) => p.state === "data").map((p) => p.platform);
  const notLinked = r.platforms.filter((p) => p.state === "niet-gekoppeld").map((p) => p.platform);
  const quiet = r.platforms.filter((p) => p.state === "stil").map((p) => p.platform);

  const secondary = [
    { key: "likes", icon: <Heart className="size-4" />, label: "Likes", value: num(r.likes), has: r.likes > 0 },
    { key: "comments", icon: <MessageSquare className="size-4" />, label: "Reacties", value: num(r.comments), has: r.comments > 0 },
    { key: "saves", icon: <Share2 className="size-4" />, label: "Shares & opgeslagen", value: num(r.valuableInteractions), has: r.valuableInteractions > 0 },
    { key: "watch", icon: <Clock className="size-4" />, label: "Gem. kijktijd", value: fmtWatch(r.avgWatchSeconds), has: r.avgWatchSeconds > 0 },
  ].filter((s) => s.has);

  const highlights = buildHighlights(r);

  const compareTable = (
        <section className="sc-glass overflow-hidden p-0">
          <div className="px-5 pt-5">
            <h2 className="text-base font-semibold">Vergeleken met {versus}</h2>
            <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">{formatDate(r.prevStart)} – {formatDate(r.prevEnd)}. Een percentage tonen we alleen als er over die periode genoeg gegevens zijn.</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                  <th className="px-5 py-2 font-semibold">Statistiek</th>
                  <th className="px-5 py-2 text-right font-semibold">{capitalize(versusShort)}</th>
                  <th className="px-5 py-2 text-right font-semibold">{capitalize(period.label)}</th>
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
  );

  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-col gap-4">
        <ResultControls
          basePath={basePath}
          mode={period.mode}
          periodKey={r.periodKey}
          months={options.months}
          quarters={options.quarters}
          from={r.periodKey === "custom" ? r.periodStart : undefined}
          to={r.periodKey === "custom" ? r.periodEnd : undefined}
          download={download}
          shareHref={`${shareHref}?${query}`}
        />
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{isQuarter ? "Kwartaaloverzicht" : period.mode === "maand" ? "Maandresultaten" : "Resultaten"}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {periodLabel}
            {r.lastUpdated ? <span className="text-[var(--color-ink-faint)]"> · bijgewerkt op {formatDate(r.lastUpdated)}</span> : null}
          </p>
          {r.lastUpdated && staleDays(r.lastUpdated) >= 3 ? (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-[var(--st-blue-bg)] px-3 py-1 text-[12.5px] font-medium text-[var(--st-blue)]">
              <span className="size-1.5 rounded-full bg-current" /> Je ziet de laatst opgehaalde cijfers. Nieuwe cijfers worden automatisch bijgewerkt.
            </p>
          ) : null}
        </div>
      </div>

      {/* Zonder cijfers: welke kanalen (nog) niet leveren. Met cijfers staat dit bij Resultaten per platform. */}
      {!r.hasData && r.platforms.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-[var(--color-ink-muted)]">Kanalen:</span>
          {withData.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-green-bg)] px-2.5 py-1 font-medium text-[var(--st-green)]">
              <span className="size-1.5 rounded-full bg-[var(--st-green)]" /> {PLATFORM[p]?.label ?? p}
            </span>
          ))}
          {quiet.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-grey-bg)] px-2.5 py-1 font-medium text-[var(--st-grey)]" title="Gekoppeld, maar in deze periode geen activiteit.">
              <span className="size-1.5 rounded-full bg-[var(--st-grey)]" /> {PLATFORM[p]?.label ?? p} · geen activiteit
            </span>
          ))}
          {notLinked.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-grey-bg)] px-2.5 py-1 font-medium text-[var(--st-grey)]" title="De cijfers van dit kanaal zijn nog niet gekoppeld.">
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
          {/* Kwartaal: eerst de samenvatting die de klant kan doorsturen */}
          {isQuarter && review ? <ManagementSummary review={review} copyText={summaryText} /> : null}
          {isQuarter && kwartaalRapport !== undefined ? <KwartaalRapportLink rapport={kwartaalRapport} label={capitalize(period.label)} /> : null}
          {directie && period.mode === "maand" ? <DirectieDownloads pdfHref={pdfHref} query={query} periodKey={r.periodKey} /> : null}

          {/* Kerncijfers */}
          <div className="flex flex-col gap-[14px]">
          <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-5">
            <Kpi hero icon={<Eye className="size-4" />} label="Totale weergaven" value={r.metrics.views} pct={r.deltas.views} versus={versus} />
            <Kpi icon={<BarChart3 className="size-4" />} label="Bereik" value={r.metrics.reach} pct={r.deltas.reach} versus={versusShort} />
            <Kpi icon={<Users className="size-4" />} label="Nieuwe volgers" value={r.metrics.followerGrowth} prefix={r.metrics.followerGrowth > 0 ? "+" : ""} pct={r.deltas.followerGrowth} versus={versusShort} />
            <Kpi icon={<Film className="size-4" />} label="Posts geplaatst" value={r.metrics.publishedVideos} pct={r.deltas.publishedVideos} versus={versusShort} />
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
          </div>

          {/* Mijlpaal: totaal sinds de start en de volgende drempel */}
          {r.milestone?.reached ? (
            <div className="flex flex-col gap-3 rounded-[16px] border border-[color-mix(in_srgb,var(--st-green)_30%,transparent)] bg-[var(--st-green-bg)] px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[var(--st-green)] text-white"><Trophy className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--st-green)]">Mijlpaal behaald</div>
                <div className="mt-0.5 text-[16px] font-bold">{compact(r.milestone.reached)} weergaven in totaal sinds de start</div>
                <div className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
                  {r.metrics.views > 0 ? <>In deze periode kwamen er <b className="text-[var(--color-ink)]">{compact(r.metrics.views)}</b> bij. </> : null}
                  {r.milestone.next ? <>Nog {compact(r.milestone.next - r.milestone.lifetimeViews)} tot {compact(r.milestone.next)}.</> : null}
                </div>
              </div>
              {r.milestone.next ? (
                <div className="w-full sm:w-48">
                  <div className="flex justify-between text-[11.5px] text-[var(--color-ink-muted)]"><span>Op weg naar {compact(r.milestone.next)}</span><b className="tabular-nums text-[var(--st-green)]">{r.milestone.progressPct}%</b></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/60"><div className="h-full rounded-full bg-[var(--st-green)]" style={{ width: `${Math.min(100, r.milestone.progressPct)}%` }} /></div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Best presterende video's → per platform → per video, met één platformfilter */}
          <ResultsExplorer videos={r.videos} platforms={r.platforms} initialPlatform={initialPlatform} />

          {/* Wat valt op? Successen groen, aandachtspunten oranje; alleen uit de echte cijfers */}
          <WatValtOp items={highlights} />

          {/* Kwartaal: de maanden naast elkaar, vergelijking, wat werkt, bedrijfsimpact en advies */}
          {isQuarter && review ? <QuarterMonths review={review} /> : null}
          {isQuarter ? compareTable : null}
          {isQuarter && review ? (
            <>
              <WhatWorks review={review} />
              <BusinessImpact review={review} />
              <NextAdvice review={review} />
              {analysisHref ? <AnalysisLinks items={review.quarterReports} hrefFor={analysisHref} title="Maandanalyses van dit kwartaal" /> : null}
            </>
          ) : null}
          {period.mode === "maand" && review?.monthlyReport && analysisHref ? (
            <AnalysisLinks items={[review.monthlyReport]} hrefFor={analysisHref} title="De maandanalyse van deze maand staat klaar" />
          ) : null}

          {!isQuarter ? compareTable : null}

          <p className="flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
            <Bookmark className="size-3.5" /> Cijfers komen automatisch uit je gekoppelde kanalen (via Metricool). Weergaven van kanalen zonder dagcijfers (zoals Facebook) tellen mee via de video&apos;s die in de periode zijn geplaatst.
          </p>
        </>
      )}
    </div>
  );
}

/** Aantal dagen tussen de laatste meetdag en vandaag (cijfers lopen normaal één dag achter). */
function staleDays(lastUpdated: string): number {
  const last = Date.parse(`${lastUpdated.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(last)) return 0;
  return Math.floor((Date.now() - last) / 86_400_000);
}
