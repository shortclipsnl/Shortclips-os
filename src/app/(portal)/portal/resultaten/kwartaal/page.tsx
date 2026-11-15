import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalQuarterDetail, getPortalQuarterlyReports } from "@/server/quarterly/service";
import { PortalDownloadButton } from "@/components/portal/download-button";
import { KlantReportView } from "@/components/quarterly/klant-report";

export const metadata: Metadata = { title: "Kwartaalresultaten" };
export const dynamic = "force-dynamic";

const nf = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n).toLocaleString("nl-NL") : "–");
const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "");
const SECTIES: Array<[string, string]> = [["samenvatting", "Managementsamenvatting"], ["kpi", "Belangrijkste resultaten"], ["ontwikkeling", "Grafieken"], ["content", "Succesvolle video's"], ["geleerd", "Belangrijkste inzichten"], ["verbeterpunten", "Verbeterpunten"], ["plan", "Actieplan"]];

/**
 * Kwartaalresultaten in het klantportaal. Toont uitsluitend rapportages die
 * door Shortclips zijn goedgekeurd en gepubliceerd, en alleen van de eigen klant.
 */
export default async function PortalKwartaalPage({ searchParams }: { searchParams: Promise<{ rapport?: string }> }) {
  const viewer = await requirePortal();
  const sp = await searchParams;
  const lijst = await getPortalQuarterlyReports(viewer);
  const gekozen = lijst.find((r) => r.id === sp.rapport) ?? lijst[0] ?? null;
  const rapport = gekozen ? await getPortalQuarterDetail(viewer, gekozen.id) : null;
  // Vergelijking tussen kwartalen: oudste eerst, alleen gepubliceerde rapportages.
  const reeks = [...lijst].reverse().filter((r) => r.totaal);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Kwartaalresultaten</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">Elk kwartaal zetten we op een rij wat de content heeft opgeleverd, wat we over jullie doelgroep hebben geleerd en wat we de komende drie maanden gaan doen.</p>
      </div>

      {lijst.length === 0 || !rapport || !gekozen ? (
        <div className="flex items-center gap-3 rounded-[16px] border border-dashed border-[var(--sc-line,var(--color-line))] bg-[var(--sc-fill,var(--color-surface-sunken))] px-5 py-6">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--sc-fill-strong,var(--color-surface-2))] text-[var(--color-ink-faint)]"><CalendarClock className="size-5" /></span>
          <p className="text-[14px] text-[var(--color-ink-muted)]">Er is nog geen kwartaalrapportage beschikbaar. Een rapportage verschijnt hier zodra het kwartaal is afgerond en ons team de resultaten heeft gecontroleerd. Je krijgt dan een melding.</p>
        </div>
      ) : (
        <>
          {/* Kwartaal kiezen en downloaden */}
          <div className="sc-glass flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="min-w-0">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Kies een kwartaal</p>
              <div className="flex flex-wrap gap-1.5">
                {lijst.map((r) => (
                  <Link key={r.id} href={`/portal/resultaten/kwartaal?rapport=${r.id}`} aria-current={r.id === gekozen.id ? "page" : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${r.id === gekozen.id ? "border-[var(--color-indigo-ink,#00003b)] bg-[var(--color-indigo-ink,#00003b)] text-white" : "border-[var(--sc-line,var(--color-line))] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
                    {r.periodLabel}
                    {r.nieuw ? <span className={`size-1.5 rounded-full ${r.id === gekozen.id ? "bg-white" : "bg-[var(--st-green,#17784c)]"}`} title="Nieuw" /> : null}
                  </Link>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">{gekozen.nieuw ? "Nieuw: " : ""}gepubliceerd op {datum(gekozen.publishedAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <PortalDownloadButton href={`/api/portal/kwartaalrapport/${gekozen.id}/pdf`} filename={`Shortclips_Kwartaalrapportage_${gekozen.periodKey}.pdf`} label="Volledige rapportage (PDF)" busyLabel="PDF wordt gemaakt…"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--color-indigo-ink,#00003b)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-70" />
              <PortalDownloadButton href={`/api/portal/kwartaalrapport/${gekozen.id}/pdf?versie=directie`} filename={`Shortclips_Directieoverzicht_${gekozen.periodKey}.pdf`} label="Directieoverzicht (1 pagina)" busyLabel="PDF wordt gemaakt…"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--sc-line,var(--color-line))] px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:opacity-90 disabled:opacity-70" />
            </div>
          </div>

          {/* Snel naar een onderdeel */}
          <nav aria-label="Onderdelen" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {SECTIES.map(([id, label]) => <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full bg-[var(--sc-fill,var(--color-surface-sunken))] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">{label}</a>)}
          </nav>

          <KlantReportView rapport={rapport} card="sc-glass" />

          {/* Vergelijken met voorgaande kwartalen */}
          <section id="vergelijken" className="sc-glass scroll-mt-24 p-5 sm:p-7">
            <h2 className="text-[20px] font-bold tracking-tight">Vergelijken met voorgaande kwartalen</h2>
            {reeks.length < 2 ? (
              <p className="mt-2 text-[13.5px] text-[var(--color-ink-muted)]">Dit is de eerste kwartaalrapportage. Zodra er een tweede is, zie je hier de ontwikkeling van kwartaal tot kwartaal.</p>
            ) : (
              <>
                <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">De kerncijfers per gepubliceerd kwartaal. Kwartalen die niet volledig gemeten zijn, staan gemarkeerd.</p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[13.5px]">
                    <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-[var(--color-ink-faint)]"><th className="py-1.5 font-semibold">Kwartaal</th><th className="py-1.5 text-right font-semibold">Video&apos;s</th><th className="py-1.5 text-right font-semibold">Weergaven</th><th className="py-1.5 text-right font-semibold">Per video</th><th className="py-1.5 text-right font-semibold">Bereik</th><th className="py-1.5 text-right font-semibold">Interacties</th><th className="py-1.5 text-right font-semibold">Volgers</th></tr></thead>
                    <tbody>
                      {reeks.map((r) => {
                        const t = r.totaal!;
                        const onvolledig = t.meetdagen < t.dagen * 0.8;
                        return (
                          <tr key={r.id} className={`border-t border-[var(--sc-line,var(--color-line))] ${r.id === gekozen.id ? "font-semibold" : ""}`}>
                            <td className="py-2"><Link href={`/portal/resultaten/kwartaal?rapport=${r.id}`} className="hover:underline">{r.periodLabel}</Link>{onvolledig ? <span className="ml-1.5 text-[11px] font-normal text-[var(--st-orange,#b4470b)]">niet volledig gemeten</span> : null}</td>
                            <td className="py-2 text-right tabular-nums">{nf(t.videos)}</td><td className="py-2 text-right tabular-nums">{nf(t.views)}</td><td className="py-2 text-right tabular-nums">{nf(t.gemViewsPerVideo)}</td>
                            <td className="py-2 text-right tabular-nums">{nf(t.reach)}</td><td className="py-2 text-right tabular-nums">{nf(t.engagements)}</td><td className="py-2 text-right tabular-nums">{t.followerGrowth >= 0 ? "+" : ""}{nf(t.followerGrowth)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
