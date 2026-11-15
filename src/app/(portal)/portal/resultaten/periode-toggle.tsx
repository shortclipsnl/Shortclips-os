import Link from "next/link";

/**
 * Keuze bovenaan Resultaten: Maand | Kwartaal. Een stip bij Kwartaal laat zien
 * dat er een nieuwe kwartaalrapportage klaarstaat.
 */
export function PeriodeToggle({ active, nieuwKwartaal = false }: { active: "maand" | "kwartaal"; nieuwKwartaal?: boolean }) {
  const cls = (on: boolean) =>
    `inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition ${on ? "bg-[var(--color-indigo-ink,#00003b)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`;
  return (
    <nav aria-label="Periode" className="inline-flex self-start rounded-full border border-[var(--sc-line,var(--color-line))] bg-[var(--color-surface)] p-1">
      <Link href="/portal/resultaten" className={cls(active === "maand")} aria-current={active === "maand" ? "page" : undefined}>Maand</Link>
      <Link href="/portal/resultaten/kwartaal" className={cls(active === "kwartaal")} aria-current={active === "kwartaal" ? "page" : undefined}>
        Kwartaal
        {nieuwKwartaal ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--st-green-bg,#e3f4ec)] px-2 py-0.5 text-[11px] font-semibold text-[var(--st-green,#17784c)]"><span className="size-1.5 rounded-full bg-[var(--st-green,#17784c)]" /> Nieuw</span> : null}
      </Link>
    </nav>
  );
}
