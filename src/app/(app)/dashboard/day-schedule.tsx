"use client";

import { useEffect, useState } from "react";

/**
 * Dagindeling Shortclips — de vaste dagelijkse werkstructuur. Compact en in de
 * huisstijl (donkerblauw/wit). De actuele activiteit licht op tijdens werktijd,
 * de eerstvolgende activiteit wordt apart gemarkeerd.
 */
type Slot = { from: number; to: number; time: string; label: string };

// Tijden in minuten sinds middernacht. `to` bepaalt wanneer een blok "nu" is.
const SLOTS: Slot[] = [
  { from: 510, to: 750, time: "08:30", label: "Dagstart: WhatsApp, e-mail, klantcontact en editors" },
  { from: 750, to: 780, time: "12:30–13:00", label: "Lunchpauze" },
  { from: 780, to: 810, time: "13:00–13:30", label: "Deadlinecontrole: wat moet vandaag echt af?" },
  { from: 1005, to: 1050, time: "16:45", label: "Takenlijst voor de volgende werkdag voorbereiden" },
];

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function DayScheduleStrip() {
  // Pas na mount updaten: voorkomt hydration-mismatch tussen server en client.
  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    setMins(nowMinutes());
    const id = setInterval(() => setMins(nowMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);

  const activeIdx = mins == null ? -1 : SLOTS.findIndex((s) => mins >= s.from && mins < s.to);
  const nextIdx =
    mins == null ? -1 : activeIdx >= 0 ? -1 : SLOTS.findIndex((s) => s.from > mins);
  const isWeekend = mins != null && [0, 6].includes(new Date().getDay());

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] text-white">
      <div className="flex items-center justify-between gap-2 px-5 py-2.5">
        <h2 className="text-sm font-bold tracking-tight">Dagindeling Shortclips</h2>
        <span className="text-2xs text-white/55">
          {isWeekend ? "weekend" : activeIdx >= 0 ? "nu bezig" : nextIdx >= 0 ? "straks" : "buiten werktijd"}
        </span>
      </div>
      <div className="grid gap-px bg-white/10 sm:grid-cols-4">
        {SLOTS.map((s, i) => {
          const active = i === activeIdx;
          const next = i === nextIdx;
          return (
            <div
              key={s.time}
              className={
                active
                  ? "bg-[var(--color-brand-600)] px-4 py-3"
                  : next
                    ? "bg-white/10 px-4 py-3"
                    : "bg-[var(--color-indigo-ink)] px-4 py-3"
              }
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tabular-nums">{s.time}</span>
                {active ? <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-2xs font-semibold">NU</span> : null}
                {next ? <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-2xs font-semibold text-white/80">straks</span> : null}
              </div>
              <p className={`mt-1 text-xs leading-snug ${active ? "text-white" : "text-white/65"}`}>{s.label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
