import Link from "next/link";
import { Gauge } from "lucide-react";
import { loadRadarData } from "@/server/capacity-radar";
import { buildAlerts, computeRadar, countBottlenecks, type RadarStatus } from "@/lib/capacity-radar";

const COLOR: Record<"green" | "orange" | "red", string> = { green: "#9fd3bd", orange: "#f0c67e", red: "#e98f86" };

/**
 * Compacte samenvatting van de capaciteitsradar op de Vandaag-pagina. Eén blok,
 * de details staan op Productie › Capaciteit. Faalt stil: de Vandaag-pagina mag
 * hier nooit op breken.
 */
export async function CapacityCard() {
  let summary: { count: number; weeks: { label: string; worst: "green" | "orange" | "red" }[]; lines: string[] } | null = null;
  try {
    const data = await loadRadarData();
    const result = computeRadar(data);
    const W = 6;
    const count = countBottlenecks(result, data.people, W);
    const rank = (s: RadarStatus) => (s === "red" ? 2 : s === "orange" ? 1 : 0);
    const weeks = result.weeks.slice(0, W).map((w) => {
      let worst = 0;
      for (const p of data.people) worst = Math.max(worst, rank(result.cells[p.id][w.i].status));
      if (result.unassigned[w.i].length) worst = Math.max(worst, 1);
      return { label: w.label, worst: (["green", "orange", "red"] as const)[worst] };
    });
    const lines = buildAlerts(result, data.people, data.settings, { weeks: W, video: true, edit: true }).slice(0, 2).map((a) => a.title);
    summary = { count, weeks, lines };
  } catch {
    return null;
  }
  if (!summary) return null;
  return (
    <Link href="/capaciteit" className="block rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3.5 transition hover:border-[var(--color-line-strong)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="size-4" /> Productiecapaciteit
        </div>
        <div className={`text-sm font-semibold ${summary.count ? "text-[#b23a2f]" : "text-[#1f7552]"}`}>
          {summary.count ? `${summary.count} ${summary.count === 1 ? "knelpunt" : "knelpunten"} in de komende 6 weken` : "Alles past de komende 6 weken"}
        </div>
        <div className="flex min-w-[160px] flex-1 gap-1" aria-hidden>
          {summary.weeks.map((w) => (
            <i key={w.label} title={w.label} className="h-2 flex-1 rounded-full" style={{ background: COLOR[w.worst] }} />
          ))}
        </div>
        <span className="text-xs font-semibold text-[var(--color-ink)]">Bekijk capaciteit ›</span>
      </div>
      {summary.lines.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-ink-muted)]">
          {summary.lines.map((l) => <li key={l}>• {l}</li>)}
        </ul>
      ) : null}
    </Link>
  );
}
