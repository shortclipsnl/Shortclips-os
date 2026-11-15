import Link from "next/link";

/**
 * Tabs van de centrale rapportageomgeving: Maandrapportages | Kwartaalrapportages.
 * Staat bovenaan beide pagina's, zodat je met één klik wisselt.
 */
export function RapportageTabs({ active, kwartaalActie = 0 }: { active: "maand" | "kwartaal"; kwartaalActie?: number }) {
  const tab = (on: boolean) =>
    `inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-2 text-sm font-semibold transition-colors sm:px-4 ${on ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"}`;
  return (
    <nav aria-label="Rapportages" className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
      <Link href="/analytics/maandrapportages" className={tab(active === "maand")} aria-current={active === "maand" ? "page" : undefined}>Maandrapportages</Link>
      <Link href="/analytics/kwartaalrapportages" className={tab(active === "kwartaal")} aria-current={active === "kwartaal" ? "page" : undefined}>
        Kwartaalrapportages
        {kwartaalActie > 0 ? <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active === "kwartaal" ? "bg-white/20" : "bg-[var(--color-warn-soft)] text-[#8a5300]"}`}>{kwartaalActie}</span> : null}
      </Link>
    </nav>
  );
}
