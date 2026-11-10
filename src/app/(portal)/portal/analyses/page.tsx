import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, Clock, FileBarChart } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalMonthlyReports } from "@/server/reports/service";

export const metadata: Metadata = { title: "Maandanalyses" };
export const dynamic = "force-dynamic";

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "";
}

const ym = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;
function monthsBack(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y!, (m ?? 1) - 1 - n, 1);
  return ym(d.getFullYear(), d.getMonth());
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function PortalAnalysesPage() {
  const viewer = await requirePortal();
  const reports = await getPortalMonthlyReports(viewer);
  const byPeriod = new Map(reports.map((r) => [r.period, r]));

  // Chronologische maandenlijst (nieuwste eerst): van de afgelopen maand terug tot
  // minstens 6 maanden, en zo nodig verder om alle beschikbare analyses te dekken.
  const now = new Date();
  const endKey = monthsBack(ym(now.getFullYear(), now.getMonth()), 1); // vorige maand
  const periods = reports.map((r) => r.period).sort();
  const sixBack = monthsBack(endKey, 5);
  const startKey = periods.length && periods[0]! < sixBack ? periods[0]! : sixBack;
  const months: string[] = [];
  for (let k = endKey; k >= startKey; k = monthsBack(k, 1)) months.push(k);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Maandelijkse analyses</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Per maand delen we onze belangrijkste inzichten en aanpak. Je ziet meteen welke analyses beschikbaar zijn en welke nog worden toegevoegd.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {months.map((key) => {
          const r = byPeriod.get(key);
          if (r) {
            return (
              <Link
                key={key}
                href={`/portal/analyses/${r.id}`}
                className="group block overflow-hidden rounded-[16px] border border-[var(--st-green)]/35 shadow-[var(--shadow-card)] transition hover:border-[var(--sc-accent)]"
                style={{ background: "color-mix(in srgb, var(--st-green) 7%, transparent)" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--st-green-bg)] text-[var(--st-green)]"><FileBarChart className="size-[18px]" /></span>
                    <div>
                      <p className="text-[16px] font-bold capitalize text-[var(--color-ink)]">{r.periodLabel}</p>
                      <p className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--st-green)]"><span className="size-1.5 rounded-full bg-[var(--st-green)]" /> Analyse beschikbaar{r.publishedAt ? ` · ${fmt(r.publishedAt)}` : ""}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--sc-accent)]">Bekijk analyse <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
                </div>
                {r.samenvatting ? <p className="line-clamp-2 whitespace-pre-line px-5 pb-4 pt-2.5 text-[13.5px] text-[var(--color-ink-muted)]">{r.samenvatting}</p> : <div className="h-3" />}
              </Link>
            );
          }
          return (
            <div key={key} className="flex items-center justify-between gap-3 rounded-[16px] border border-dashed border-[var(--sc-line)] bg-[var(--sc-fill)] px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--sc-fill-strong)] text-[var(--color-ink-faint)]"><CalendarClock className="size-[18px]" /></span>
                <p className="text-[15px] font-semibold capitalize text-[var(--color-ink-muted)]">{monthLabel(key)}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-orange-bg)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--st-orange)]">
                <Clock className="size-3.5" /> Nog toe te voegen
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[12.5px] text-[var(--color-ink-faint)]">
        Een maandanalyse verschijnt zodra de maand is afgerond en ons team de resultaten heeft gecontroleerd.
      </p>
    </div>
  );
}
