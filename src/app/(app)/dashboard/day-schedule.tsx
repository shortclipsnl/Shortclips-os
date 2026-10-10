"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/**
 * Dagindeling Shortclips — de vaste dagstructuur als realtime tijdlijn. Een
 * "nu"-indicator beweegt mee met de Nederlandse tijd, afgeronde blokken zijn
 * gedempt en het actieve blok vult zich langzaam. Compact en in de huisstijl.
 */
type Slot = { from: number; to: number; time: string; label: string };

// Tijden in minuten sinds middernacht.
const SLOTS: Slot[] = [
  { from: 510, to: 540, time: "08:30", label: "Dagstart: WhatsApp, e-mail, klantcontact en editors" },
  { from: 750, to: 780, time: "12:30–13:00", label: "Lunchpauze" },
  { from: 780, to: 810, time: "13:00–13:30", label: "Deadlinecontrole: wat moet vandaag echt af?" },
  { from: 1005, to: 1035, time: "16:45", label: "Takenlijst voor de volgende werkdag voorbereiden" },
];

// Het zichtbare dagvenster van de tijdlijn (08:00–17:30).
const DAY_START = 480;
const DAY_END = 1050;
const SPAN = DAY_END - DAY_START;
const HOUR_TICKS = [480, 600, 720, 840, 960, 1050]; // 08, 10, 12, 14, 16, 17:30

/** Huidige tijd in minuten sinds middernacht, in de tijdzone Europa/Amsterdam. */
function nowMinutesNL(): number {
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}
function weekdayNL(): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Amsterdam", weekday: "short" }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}
function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const pos = (min: number) => `${Math.min(100, Math.max(0, ((min - DAY_START) / SPAN) * 100))}%`;

export function DayScheduleStrip() {
  // Pas na mount updaten: voorkomt hydration-mismatch tussen server en client.
  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setMins(nowMinutesNL());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const weekend = mins != null && [0, 6].includes(weekdayNL());
  const now = mins ?? -1;
  const withinDay = mins != null && now >= DAY_START && now <= DAY_END && !weekend;
  const activeIdx = mins == null ? -1 : SLOTS.findIndex((s) => now >= s.from && now < s.to);
  const nextIdx = mins == null || activeIdx >= 0 ? -1 : SLOTS.findIndex((s) => s.from > now);

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] text-white">
      <div className="flex items-center justify-between gap-2 px-5 py-2.5">
        <h2 className="text-sm font-bold tracking-tight">Dagindeling Shortclips</h2>
        <span className="flex items-center gap-2 text-2xs text-white/60">
          {mins != null ? <span className="tabular-nums">{hhmm(now)} NL</span> : null}
          <span className="rounded-full bg-white/10 px-2 py-0.5">
            {weekend ? "weekend" : activeIdx >= 0 ? "nu bezig" : nextIdx >= 0 ? "straks" : withinDay ? "werktijd" : "buiten werktijd"}
          </span>
        </span>
      </div>

      {/* Realtime tijdlijn */}
      <div className="px-5 pb-2 pt-1">
        <div className="relative h-9">
          {/* Spoor */}
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/12" />
          {/* Verstreken deel van de dag */}
          {withinDay ? (
            <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-brand-500)]/50" style={{ width: pos(now) }} />
          ) : null}
          {/* Uur-ticks */}
          {HOUR_TICKS.map((t) => (
            <div key={t} className="absolute top-1/2 -translate-y-1/2" style={{ left: pos(t) }}>
              <span className="block size-1 rounded-full bg-white/30" />
              <span className="absolute left-1/2 top-3 -translate-x-1/2 text-[9px] tabular-nums text-white/35">{hhmm(t).slice(0, 5)}</span>
            </div>
          ))}
          {/* Activiteitsblokken op het spoor */}
          {SLOTS.map((s, i) => {
            const done = now >= s.to;
            const active = i === activeIdx;
            const left = ((s.from - DAY_START) / SPAN) * 100;
            const width = Math.max(1.5, ((s.to - s.from) / SPAN) * 100);
            return (
              <div
                key={s.time}
                className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: active ? "var(--color-brand-500)" : done ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.18)",
                  boxShadow: active ? "0 0 0 2px rgba(255,255,255,0.35)" : undefined,
                }}
                title={`${s.time} — ${s.label}`}
              />
            );
          })}
          {/* "Nu"-indicator: beweegt mee met de tijd */}
          {withinDay ? (
            <div className="absolute top-0 bottom-0 z-10 w-px bg-[var(--color-bad)]" style={{ left: pos(now) }}>
              <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-[var(--color-bad)]" />
            </div>
          ) : null}
        </div>
      </div>

      {/* Blokken met voortgang — afgerond, nu bezig of toekomstig */}
      <div className="grid gap-px bg-white/10 sm:grid-cols-4">
        {SLOTS.map((s, i) => {
          const done = now >= s.to;
          const active = i === activeIdx;
          const next = i === nextIdx;
          const progress = active ? Math.min(100, Math.max(0, ((now - s.from) / (s.to - s.from)) * 100)) : done ? 100 : 0;
          return (
            <div
              key={s.time}
              className={active ? "bg-[var(--color-brand-600)] px-4 py-3" : "bg-[var(--color-indigo-ink)] px-4 py-3"}
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-sm font-bold tabular-nums ${done && !active ? "text-white/45" : "text-white"}`}>{s.time}</span>
                {active ? <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-2xs font-semibold">NU</span> : null}
                {next ? <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-2xs font-semibold text-white/80">straks</span> : null}
                {done && !active ? <Check className="size-3.5 text-white/45" /> : null}
              </div>
              <p className={`mt-1 text-xs leading-snug ${active ? "text-white" : done ? "text-white/40" : "text-white/65"}`}>{s.label}</p>
              {/* Voortgangsbalk: langzaam gevuld tijdens het actieve blok. */}
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                <span className="block h-full rounded-full bg-white/70 transition-[width] duration-700" style={{ width: `${progress}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
