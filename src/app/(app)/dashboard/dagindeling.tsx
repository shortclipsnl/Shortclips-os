"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

export type ScheduleItem = { from: string; to?: string; label: string; detail?: string };

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Begin en einde van de werkdag — de lijn loopt hier tussen op. */
const DAY_START = "08:00";
const DAY_END = "17:00";

function nowMinutesAmsterdam(): number {
  const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Amsterdam" });
  return toMin(t);
}

/**
 * Het vaste dagritme, maar nu als live tijdlijn: bovenin een balk die vanzelf
 * oploopt tot het einde van de dag, en per blok de tijden naast elkaar. Wat
 * geweest is, wordt groen doorgestreept; wat nu speelt, is gemarkeerd.
 */
export function Dagindeling({ items }: { items: ScheduleItem[] }) {
  // Pas na mount de echte tijd gebruiken (voorkomt hydration-verschil met de
  // server). Daarna elke 30s verversen zodat de lijn vanzelf oploopt.
  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => {
    setNowMin(nowMinutesAmsterdam());
    const id = setInterval(() => setNowMin(nowMinutesAmsterdam()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dayStart = toMin(DAY_START);
  const dayEnd = toMin(DAY_END);
  const dayPct = nowMin == null ? 0 : Math.max(0, Math.min(100, ((nowMin - dayStart) / (dayEnd - dayStart)) * 100));
  const nowLabel =
    nowMin == null ? "" : `${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`;

  return (
    <div className="px-4 py-4">
      {/* Voortgangslijn van de dag — loopt automatisch op tot 17:00. */}
      <div className="mb-4">
        <div className="mb-1 text-2xs font-semibold text-[var(--color-good)]">
          {nowMin == null ? "—" : nowMin < dayStart ? "Werkdag nog niet begonnen" : nowMin >= dayEnd ? "Werkdag voorbij" : `Nu ${nowLabel} · ${Math.round(dayPct)}% van de dag`}
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
          <span className="block h-full rounded-full bg-[var(--color-good)] transition-[width] duration-700" style={{ width: `${dayPct}%` }} />
          {nowMin != null && nowMin > dayStart && nowMin < dayEnd ? (
            <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--color-good)] shadow" style={{ left: `${dayPct}%` }} />
          ) : null}
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-medium text-[var(--color-ink-faint)]">
          <span>{DAY_START}</span>
          <span>{DAY_END}</span>
        </div>
      </div>

      {/* De blokken zelf: tijden naast elkaar bovenaan, label + toelichting
          daaronder op volle breedte. Geweest = groen doorgestreept. */}
      <ul className="space-y-1.5">
        {items.map((it) => {
          const start = toMin(it.from);
          const end = it.to ? toMin(it.to) : start + 15;
          const status: "straks" | "nu" | "geweest" =
            nowMin == null || nowMin < start ? "straks" : nowMin < end ? "nu" : "geweest";
          const done = status === "geweest";
          return (
            <li
              key={it.from + it.label}
              className={`rounded-[var(--radius-sm)] px-2.5 py-2 ${status === "nu" ? "bg-[var(--color-good-soft)]/70 ring-1 ring-[var(--color-good)]/30" : "bg-[var(--color-surface-sunken)]/40"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-bold tabular-nums ${done ? "text-[var(--color-ink-faint)]" : status === "nu" ? "text-[var(--color-good)]" : "text-[var(--color-ink)]"}`}>
                  {it.from}{it.to ? ` – ${it.to}` : ""}
                </span>
                {status === "nu" ? (
                  <span className="shrink-0 rounded-full bg-[var(--color-good)] px-2 py-0.5 text-2xs font-bold text-white">Nu</span>
                ) : status === "straks" ? (
                  <span className="shrink-0 text-2xs font-medium text-[var(--color-ink-faint)]">straks</span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-0.5 text-2xs font-semibold text-[var(--color-good)]"><Check className="size-3" strokeWidth={3} />gedaan</span>
                )}
              </div>
              <div className={`mt-0.5 text-sm leading-snug ${done ? "text-[var(--color-good)] line-through decoration-[var(--color-good)]/60" : status === "nu" ? "font-semibold" : "font-medium"}`}>
                {it.label}
              </div>
              {it.detail ? (
                <div className={`mt-0.5 text-xs leading-snug ${done ? "text-[var(--color-ink-faint)]" : "text-[var(--color-ink-muted)]"}`}>
                  {it.detail}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
