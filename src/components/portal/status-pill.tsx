import type { ReactNode } from "react";

/**
 * Functionele statuslabels voor het klantportaal. Vaste betekenis per kleur,
 * overal gelijk:
 *  - green  = goedgekeurd / online / klaar
 *  - orange = wacht op jou (feedback of akkoord)
 *  - blue   = wij zijn ermee bezig (voorbereiding, productie, verwerken)
 *  - red    = actie nodig / termijn verstreken
 *  - grey   = afgerond of (nog) niet beschikbaar
 */
export type StatusTone = "green" | "orange" | "blue" | "red" | "grey";

const TONE: Record<StatusTone, string> = {
  green: "bg-[var(--st-green-bg)] text-[var(--st-green)]",
  orange: "bg-[var(--st-orange-bg)] text-[var(--st-orange)]",
  blue: "bg-[var(--st-blue-bg)] text-[var(--st-blue)]",
  red: "bg-[var(--st-red-bg)] text-[var(--st-red)]",
  grey: "bg-[var(--st-grey-bg)] text-[var(--st-grey)]",
};

const DOT: Record<StatusTone, string> = {
  green: "bg-[var(--st-green)]",
  orange: "bg-[var(--st-orange)]",
  blue: "bg-[var(--st-blue)]",
  red: "bg-[var(--st-red)]",
  grey: "bg-[var(--st-grey)]",
};

export function StatusPill({ tone, children, className = "" }: { tone: StatusTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold leading-none ${TONE[tone]} ${className}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

/** Knopstijlen voor het portaal (zie globals.css): hoofdactie, klantactie, rustig. */
export const portalBtn = {
  cta: "sc-btn-cta inline-flex items-center justify-center gap-2 rounded-[10px] px-4 h-10 text-[14px] font-semibold transition-colors",
  act: "sc-btn-act inline-flex items-center justify-center gap-2 rounded-[10px] px-4 h-10 text-[14px] font-semibold transition-colors",
  soft: "sc-btn-soft inline-flex items-center justify-center gap-2 rounded-[10px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-3.5 h-9 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--sc-fill)]",
  link: "inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--sc-accent)] hover:underline",
};
