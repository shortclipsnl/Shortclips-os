"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarRange, ChevronDown, Loader2 } from "lucide-react";
import { PORTAL_PERIODS, capitalize, monthLabel, quarterLabel, type PeriodMode, type PeriodOption } from "@/lib/portal-periods";

/**
 * Periodekeuze voor de resultaten: Maandelijks | Per kwartaal, met daaronder de
 * maand of het kwartaal. Dezelfde component in het klantportaal en het interne
 * portaal, zodat beide exact dezelfde logica volgen. De keuze staat in de URL
 * (?periode=2026-10 of ?periode=2026-Q3), zodat de cijfers op de server worden
 * opgehaald en alles op de pagina tegelijk meebeweegt.
 */
export function PeriodSwitch({
  basePath,
  mode,
  periodKey,
  months,
  quarters,
  from,
  to,
  variant = "portal",
}: {
  basePath: string;
  mode: PeriodMode;
  periodKey: string;
  months: PeriodOption[];
  quarters: PeriodOption[];
  from?: string;
  to?: string;
  variant?: "portal" | "intern";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [van, setVan] = useState(from ?? "");
  const [tot, setTot] = useState(to ?? "");
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  const go = (q: string, mark: string) => {
    setTarget(mark);
    startTransition(() => {
      // Andere filters (zoals het platform) blijven staan bij het wisselen van periode.
      const keep = new URLSearchParams();
      try {
        new URL(window.location.href).searchParams.forEach((v, k) => {
          if (!["periode", "van", "tot", "dagen"].includes(k)) keep.set(k, v);
        });
      } catch {
        /* geen URL: alleen de periode */
      }
      const rest = keep.toString();
      router.push(`${basePath}?${q}${rest ? `&${rest}` : ""}`, { scroll: false });
      router.refresh();
    });
  };

  const s = STYLES[variant];
  const base = mode === "kwartaal" ? quarters : months;
  // De gekozen periode staat altijd in de lijst, ook als die buiten het standaardbereik valt.
  const options = mode === "vrij" || base.some((o) => o.key === periodKey) ? base : [{ key: periodKey, label: mode === "kwartaal" ? quarterLabel(periodKey) : monthLabel(periodKey) }, ...base];
  const seg = (m: "maand" | "kwartaal", label: string, first: PeriodOption | undefined) => {
    const active = mode === m;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        disabled={pending || !first}
        onClick={() => !active && first && go(`periode=${first.key}`, m)}
        className={`${s.segBtn} ${active ? s.segOn : s.segOff}`}
      >
        {pending && target === m ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {label}
      </button>
    );
  };

  return (
    <div className="relative flex flex-wrap items-center gap-2" aria-busy={pending}>
      <div role="tablist" aria-label="Periode" className={s.seg}>
        {seg("maand", "Maandelijks", months[0])}
        {seg("kwartaal", "Per kwartaal", quarters[0])}
      </div>

      {mode !== "vrij" ? (
        <label className={`${s.select} ${pending ? "opacity-60" : ""}`}>
          <span className="sr-only">{mode === "kwartaal" ? "Kwartaal selecteren" : "Maand selecteren"}</span>
          <select
            value={periodKey}
            disabled={pending}
            onChange={(e) => go(`periode=${e.target.value}`, "select")}
            className="w-full cursor-pointer appearance-none bg-transparent py-1.5 pl-3.5 pr-8 text-[13px] font-semibold outline-none"
          >
            {options.map((o) => (
              <option key={o.key} value={o.key} className="text-black">
                {capitalize(o.label)}
              </option>
            ))}
          </select>
          {pending && target === "select" ? (
            <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin" />
          ) : (
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2" />
          )}
        </label>
      ) : null}

      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`${s.other} ${mode === "vrij" ? s.otherOn : ""}`}>
        <CalendarRange className="size-3.5" /> Andere periode
      </button>

      {open ? (
        <div className={s.pop}>
          <div className="flex flex-wrap gap-1.5">
            {PORTAL_PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  go(`periode=${p.key}`, p.key);
                }}
                className={`${s.chip} ${periodKey === p.key ? s.chipOn : ""}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className={s.dateLabel}>
              Van
              <input type="date" value={van} max={tot || undefined} onChange={(e) => setVan(e.target.value)} className={s.date} />
            </label>
            <label className={s.dateLabel}>
              Tot
              <input type="date" value={tot} min={van || undefined} onChange={(e) => setTot(e.target.value)} className={s.date} />
            </label>
            <button
              type="button"
              disabled={!van || !tot || van > tot || pending}
              onClick={() => {
                setOpen(false);
                go(`periode=custom&van=${van}&tot=${tot}`, "custom");
              }}
              className={s.apply}
            >
              Toepassen
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const STYLES = {
  portal: {
    seg: "inline-flex items-center gap-1 rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] p-1",
    segBtn: "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13.5px] font-semibold transition-colors disabled:cursor-wait",
    segOn: "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)] shadow-sm",
    segOff: "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
    select: "relative inline-flex min-w-[168px] items-center rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] text-[var(--color-ink)] transition-opacity",
    other: "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12.5px] font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]",
    otherOn: "border border-[var(--sc-line)] bg-[var(--sc-fill)] text-[var(--color-ink)]",
    pop: "z-20 w-full rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-inset)] p-3 sm:absolute sm:left-0 sm:top-full sm:mt-2 sm:w-auto sm:shadow-xl",
    chip: "rounded-full border border-[var(--sc-line)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
    chipOn: "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]",
    dateLabel: "flex flex-col gap-1 text-[11px] text-[var(--color-ink-muted)]",
    date: "sc-input rounded-lg px-2.5 py-1.5 text-[13px]",
    apply: "sc-btn-cta inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-40",
  },
  intern: {
    seg: "inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5",
    segBtn: "inline-flex items-center gap-1.5 rounded-[4px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-wait",
    segOn: "bg-[var(--color-indigo-ink)] text-white",
    segOff: "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
    select: "relative inline-flex min-w-[160px] items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)] transition-opacity",
    other: "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
    otherOn: "border border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)]",
    pop: "z-20 w-full rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-3 sm:absolute sm:left-0 sm:top-full sm:mt-2 sm:w-auto sm:shadow-[var(--shadow-raised)]",
    chip: "rounded-full border border-[var(--color-line-strong)] px-3 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
    chipOn: "bg-[var(--color-indigo-ink)] text-white",
    dateLabel: "flex flex-col gap-1 text-[11px] text-[var(--color-ink-muted)]",
    date: "rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1 text-[13px]",
    apply: "rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40",
  },
} as const;
