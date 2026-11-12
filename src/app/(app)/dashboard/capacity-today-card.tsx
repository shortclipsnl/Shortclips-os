/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import CapEngine from "@/lib/capacity-engine";

// De rekenmotor is pure JavaScript (gedeeld met het prototype); hier ongetypeerd.
const E: any = CapEngine;
import { loadCapacityData } from "@/server/capacity-forecast";

/**
 * Compacte samenvatting op Vandaag: aantal knelpunten (persoon × periode boven
 * 100%) in de komende drie maanden, plus de belangrijkste melding. Alles
 * daarachter staat op één plek: Productie › Capaciteit.
 */
export async function CapacityTodayCard() {
  let summary: { count: number; dots: string[]; labels: string[]; first: string | null } | null = null;
  try {
    const data = await loadCapacityData();
    E.configure({ today: data.today, holidays: data.holidays });
    const engineData = { people: data.people, clients: data.clients, shoots: data.shoots, projects: data.projects };
    const st: any = { settings: { ...E.defaultSettings(), greenBelow: data.settings.greenBelow, orangeMax: data.settings.orangeMax, defaultTravel: data.settings.defaultTravel }, moves: {}, vgMoves: {}, snoozed: [] };
    const P = E.periods();
    const R = E.compute(engineData, st, Math.max(E.weeksUntil(P[P.length - 1].friday), 8));
    const WMAP: number[] = R.weeks.map((w: any) => P.findIndex((p: any) => w.days[2] >= p.monday && w.days[2] <= p.friday));
    const combos = new Set<string>();
    const worst: string[] = P.map(() => "groen");
    R.weeks.forEach((_: any, wi: number) => {
      const pi = WMAP[wi]!;
      if (pi < 0) return;
      R.vgRows.concat(R.edRows).forEach((r: any) => {
        const k = r.cells[wi].key;
        if (k === "rood") { combos.add(`${r.person.id}-${pi}`); worst[pi] = "rood"; }
        else if (k === "oranje" && worst[pi] !== "rood") worst[pi] = "oranje";
      });
    });
    const HW = WMAP.filter((x) => x >= 0).length;
    const sig = E.signals(engineData, st, R, HW, []);
    const lv = (s: any) => (s.week < 6 ? 0 : 1);
    sig.all.sort((a: any, b: any) => lv(a) - lv(b) || b.sev - a.sev);
    summary = {
      count: combos.size,
      dots: worst,
      labels: P.map((p: any) => (p.kind === "maand" ? p.label.slice(0, 3).toLowerCase() : p.kind === "rest" ? "rest" : p.label === "Deze week" ? "deze wk" : "vlg wk")),
      first: sig.all[0]?.title ?? null,
    };
  } catch (error) {
    console.error("[vandaag] capaciteitskaart", error);
    return null;
  }
  const color = (k: string) => (k === "rood" ? "var(--color-bad)" : k === "oranje" ? "#f0b04a" : "#9fd8bf");
  return (
    <Link href="/capaciteit" className="block rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 hover:border-[var(--color-line-strong)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <div className="text-xs font-semibold text-[var(--color-ink-muted)]">Productiecapaciteit</div>
          <div className="text-base font-bold" style={{ color: summary.count ? "var(--color-bad)" : "var(--color-good)" }}>
            {summary.count ? `${summary.count} ${summary.count === 1 ? "knelpunt" : "knelpunten"}` : "Geen knelpunten"}{" "}
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">komende 3 maanden</span>
          </div>
        </div>
        <div className="flex min-w-[260px] flex-1 gap-1.5">
          {summary.dots.map((k, i) => (
            <div key={i} className="flex-1 text-center text-[10px] text-[var(--color-ink-faint)]">
              <span className="mb-1 block h-2 rounded" style={{ background: color(k) }} />
              {summary!.labels[i]}
            </div>
          ))}
        </div>
        <span className="text-xs font-semibold text-[var(--color-ink)]">Open Capaciteit →</span>
      </div>
      {summary.first ? <p className="mt-2 text-xs text-[var(--color-ink-muted)]"><b className="text-[var(--color-ink)]">Eerst:</b> {summary.first}</p> : null}
    </Link>
  );
}
