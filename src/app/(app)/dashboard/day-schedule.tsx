"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Undo2 } from "lucide-react";
import { toggleChecklistItem } from "@/server/actions/checklist";

/**
 * Dagindeling Shortclips — de vaste dagstructuur als realtime checklist. Een
 * onderdeel wordt pas groen (afgerond) wanneer iemand het bevestigt; alleen de
 * tijd laten verstrijken markeert niets als voltooid. Een verstreken, niet-
 * bevestigd onderdeel is "nog bevestigen / te laat". De "nu"-indicator beweegt
 * mee met de Nederlandse tijd.
 */
type Slot = { key: string; from: number; to: number; time: string; label: string; who: string };

const SLOTS: Slot[] = [
  { key: "dagstart", from: 510, to: 540, time: "08:30", label: "Dagstart: WhatsApp, e-mail, klantcontact en editors", who: "Hele team" },
  { key: "lunch", from: 750, to: 780, time: "12:30–13:00", label: "Lunchpauze", who: "Hele team" },
  { key: "deadline", from: 780, to: 810, time: "13:00–13:30", label: "Deadlinecontrole: wat moet vandaag echt af?", who: "Milou & Jarno" },
  { key: "takenlijst", from: 1005, to: 1035, time: "16:45", label: "Takenlijst voor de volgende werkdag voorbereiden", who: "Hele team" },
];

const DAY_START = 480;
const DAY_END = 1050;
const SPAN = DAY_END - DAY_START;
const HOUR_TICKS = [480, 600, 720, 840, 960, 1050];

export type ChecklistState = Record<string, { name: string; at: string }>;

function nowMinutesNL(): number {
  const parts = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}
function weekdayNL(): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Amsterdam", weekday: "short" }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}
function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
const pos = (min: number) => `${Math.min(100, Math.max(0, ((min - DAY_START) / SPAN) * 100))}%`;

export function DayScheduleStrip({ checks }: { checks: ChecklistState }) {
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

  const doneCount = SLOTS.filter((s) => checks[s.key]).length;
  const lateCount = mins == null ? 0 : SLOTS.filter((s) => now >= s.to && !checks[s.key]).length;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
        <h2 className="text-sm font-bold tracking-tight">Dagindeling Shortclips</h2>
        <span className="flex items-center gap-2 text-2xs text-white/60">
          {mins != null ? <span className="tabular-nums">{hhmm(now)} NL</span> : null}
          <span className="rounded-full bg-[var(--color-good)]/25 px-2 py-0.5">{doneCount}/{SLOTS.length} afgerond</span>
          {lateCount > 0 ? <span className="rounded-full bg-[var(--color-bad)]/30 px-2 py-0.5">{lateCount} te laat</span> : null}
        </span>
      </div>

      {/* Realtime tijdlijn */}
      <div className="px-5 pb-2 pt-1">
        <div className="relative h-8">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/12" />
          {withinDay ? <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-brand-500)]/50" style={{ width: pos(now) }} /> : null}
          {HOUR_TICKS.map((t) => (
            <div key={t} className="absolute top-1/2 -translate-y-1/2" style={{ left: pos(t) }}>
              <span className="block size-1 rounded-full bg-white/30" />
              <span className="absolute left-1/2 top-3 -translate-x-1/2 text-[9px] tabular-nums text-white/35">{hhmm(t)}</span>
            </div>
          ))}
          {SLOTS.map((s) => {
            const confirmed = Boolean(checks[s.key]);
            const late = now >= s.to && !confirmed;
            const left = ((s.from - DAY_START) / SPAN) * 100;
            const width = Math.max(1.5, ((s.to - s.from) / SPAN) * 100);
            const bg = confirmed ? "var(--color-good)" : late ? "var(--color-bad)" : "rgba(255,255,255,0.3)";
            return <div key={s.key} className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: bg }} title={s.label} />;
          })}
          {withinDay ? (
            <div className="absolute top-0 bottom-0 z-10 w-px bg-white" style={{ left: pos(now) }}>
              <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-white" />
            </div>
          ) : null}
        </div>
      </div>

      {/* Checklist */}
      <div className="grid gap-px bg-white/10 sm:grid-cols-4">
        {SLOTS.map((s, i) => (
          <ChecklistBlock key={s.key} slot={s} check={checks[s.key]} active={i === activeIdx} passed={now >= s.to} canConfirm={mins != null} />
        ))}
      </div>
    </div>
  );
}

function ChecklistBlock({ slot, check, active, passed, canConfirm }: { slot: Slot; check?: { name: string; at: string }; active: boolean; passed: boolean; canConfirm: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirmed = Boolean(check);
  const late = passed && !confirmed;

  const bg = confirmed ? "bg-[var(--color-good)]/90" : active ? "bg-[var(--color-brand-600)]" : late ? "bg-[var(--color-bad)]/85" : "bg-[var(--color-indigo-ink)]";
  const statusText = confirmed ? "Afgerond" : late ? "Nog bevestigen" : active ? "Nu bezig" : "Komt nog";

  function toggle() {
    start(async () => { await toggleChecklistItem(slot.key); router.refresh(); });
  }

  return (
    <div className={`px-4 py-3 ${bg}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-bold tabular-nums">{slot.time}</span>
        <span className="ml-auto rounded-full bg-white/20 px-1.5 py-0.5 text-2xs font-semibold">{statusText}</span>
      </div>
      <p className={`mt-1 text-xs leading-snug ${confirmed || late || active ? "text-white" : "text-white/70"}`}>{slot.label}</p>
      <p className="mt-1 text-2xs text-white/55">{slot.who}{confirmed && check ? ` · bevestigd door ${check.name.split(" ")[0]}` : ""}</p>
      <button type="button" onClick={toggle} disabled={pending || !canConfirm}
        className="mt-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-white/15 px-2 py-1 text-2xs font-medium text-white hover:bg-white/25 disabled:opacity-60">
        {pending ? <Loader2 className="size-3 animate-spin" /> : confirmed ? <Undo2 className="size-3" /> : <Check className="size-3" />}
        {confirmed ? "Ongedaan maken" : "Afgerond"}
      </button>
    </div>
  );
}
