"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, BellRing, Check, X } from "lucide-react";
import { getEndOfDayChecklist, type EodItem } from "@/server/actions/end-of-day";

// Eindedagmelding: elke werkdag om 16:30 verschijnt rechtsonder een melding met
// een pingetje — een afvinklijst (rood/groen) of alles vandaag is afgerond.
const REMIND_MIN = 16 * 60 + 30; // 16:30 Amsterdam
const TZ = "Europe/Amsterdam";

function amsterdamNowMinutes(): number {
  const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function amsterdamWeekday(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
}
function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Een kort, vriendelijk pingetje via de Web Audio API (geen bestand nodig). */
function playPing() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const note = (freq: number, start: number, dur: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime + start;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    };
    note(880, 0, 0.18);
    note(1174.7, 0.16, 0.26);
  } catch {
    /* audio geblokkeerd (nog geen interactie) — melding blijft wel zichtbaar */
  }
}

export function EndOfDayChecklist() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<EodItem[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Alleen op werkdagen (ma–vr).
    const wd = amsterdamWeekday();
    if (wd === "Sat" || wd === "Sun") return;
    const key = `eod-checklist-dismissed-${todayKey()}`;
    try { if (localStorage.getItem(key) === "1") return; } catch { /* no storage */ }

    let alive = true;
    const show = async () => {
      const res = await getEndOfDayChecklist().catch(() => null);
      if (alive && res && res.ok) { setItems(res.data.items); setOpen(true); playPing(); }
    };
    const now = amsterdamNowMinutes();
    if (now >= REMIND_MIN) {
      void show(); // al na 16:30 en nog niet weggeklikt vandaag → meteen tonen
    } else {
      timer.current = setTimeout(() => void show(), (REMIND_MIN - now) * 60_000);
    }
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  function dismiss() {
    setOpen(false);
    try { localStorage.setItem(`eod-checklist-dismissed-${todayKey()}`, "1"); } catch { /* no storage */ }
  }

  if (!open || !items) return null;
  const allGood = items.every((i) => i.ok);
  const headColor = allGood ? "var(--color-good)" : "var(--color-warn)";

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface)] shadow-[var(--shadow-raised)]" style={{ borderColor: `color-mix(in srgb, ${headColor} 40%, var(--color-line))` }}>
      <div className="flex items-center gap-2 px-4 py-2.5 text-white" style={{ background: headColor }}>
        <BellRing className="size-5 shrink-0 animate-[pulse_1.5s_ease-in-out_3]" />
        <span className="flex-1 text-sm font-bold tracking-tight">Einde werkdag — check je af</span>
        <button type="button" onClick={dismiss} aria-label="Sluiten" className="rounded p-0.5 hover:bg-white/20">
          <X className="size-4" />
        </button>
      </div>
      <div className="p-3">
        <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
          {allGood ? "Mooi — alles van vandaag is bij. Fijne avond!" : "Loop dit nog even na voordat je afsluit:"}
        </p>
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href} className="flex items-center gap-2.5 rounded-[var(--radius-sm)] border-l-[3px] bg-[var(--color-surface-sunken)] px-2.5 py-1.5 text-sm hover:brightness-95" style={{ borderLeftColor: it.ok ? "var(--color-good)" : "var(--color-warn)" }}>
                <span className="grid size-5 shrink-0 place-items-center rounded-full text-white" style={{ background: it.ok ? "var(--color-good)" : "var(--color-warn)" }}>
                  {it.ok ? <Check className="size-3" /> : <AlertCircle className="size-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{it.label}</span>
                  <span className="block truncate text-2xs text-[var(--color-ink-muted)]">{it.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <button type="button" onClick={dismiss} className="mt-2 block w-full rounded-[var(--radius-sm)] py-1 text-center text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          Weghalen voor vandaag
        </button>
      </div>
    </div>
  );
}
