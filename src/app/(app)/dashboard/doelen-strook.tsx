import Link from "next/link";
import type { GoalRow } from "@/server/goals/overview";
import type { GoalStatus } from "@/server/goals/status";

const COLOR: Partial<Record<GoalStatus, string>> = {
  achter: "var(--color-bad)",
  risico: "var(--color-warn)",
  niet_bijgewerkt: "#8b5cf6",
};
const LABEL: Partial<Record<GoalStatus, string>> = { achter: "Achter", risico: "Risico", niet_bijgewerkt: "Niet bijgewerkt" };
const SEV: Partial<Record<GoalStatus, number>> = { achter: 0, risico: 1, niet_bijgewerkt: 2 };

/** Compacte Doelen-strook op Vandaag: alleen doelen die aandacht vragen. */
export function DoelenStrook({ rows, weekOfQuarter, totalWeeks }: { rows: GoalRow[]; weekOfQuarter: number; totalWeeks: number }) {
  const attention = rows
    .filter((r) => r.status === "achter" || r.status === "risico" || r.status === "niet_bijgewerkt")
    .sort((a, b) => (SEV[a.status] ?? 9) - (SEV[b.status] ?? 9))
    .slice(0, 5);

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold tracking-tight">Doelen Q4 · week {weekOfQuarter} van {totalWeeks}</h2>
        <Link href="/doelen" className="text-xs font-semibold text-[var(--color-brand-600)] hover:underline">Alle doelen →</Link>
      </div>
      {attention.length === 0 ? (
        <p className="mt-1.5 text-sm font-medium text-[var(--color-good)]">Alle doelen op koers.</p>
      ) : (
        <ul className="mt-2 grid gap-1">
          {attention.map((g) => (
            <li key={g.id}>
              <Link href="/doelen" className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1 hover:bg-[var(--color-surface-sunken)]">
                <span className="size-2 shrink-0 rounded-full" style={{ background: COLOR[g.status] }} />
                <span className="min-w-0 flex-1 truncate text-sm">{g.title}</span>
                <span className="shrink-0 text-2xs font-semibold uppercase tracking-wide" style={{ color: COLOR[g.status] }}>{LABEL[g.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
