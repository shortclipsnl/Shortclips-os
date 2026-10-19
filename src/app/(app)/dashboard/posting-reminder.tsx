"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellRing, X } from "lucide-react";

export type TodayPost = { id: string; title: string; clientName: string; at: string | null };

// Dagelijkse postherinnering: elke dag om 14:00 verschijnt rechtsonder een
// melding met een pingetje — "let op, vandaag moet deze post online bij klant X".
const REMIND_HOUR = 14;

function amsterdamNowMinutes(): number {
  const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Amsterdam" });
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
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

export function PostingReminder({ posts }: { posts: TodayPost[] }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (posts.length === 0) return;
    const key = `posting-reminder-dismissed-${todayKey()}`;
    let dismissed = false;
    try { dismissed = localStorage.getItem(key) === "1"; } catch { /* no storage */ }
    if (dismissed) return;

    const show = () => { setOpen(true); playPing(); };
    const nowMin = amsterdamNowMinutes();
    const remindMin = REMIND_HOUR * 60;
    if (nowMin >= remindMin) {
      // Al na 14:00 en nog niet weggeklikt vandaag → meteen tonen.
      show();
    } else {
      // Plan de melding op 14:00 (als het scherm open blijft).
      timer.current = setTimeout(show, (remindMin - nowMin) * 60_000);
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [posts.length]);

  function dismiss() {
    setOpen(false);
    try { localStorage.setItem(`posting-reminder-dismissed-${todayKey()}`, "1"); } catch { /* no storage */ }
  }

  if (!open || posts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-warn)]/40 bg-[var(--color-surface)] shadow-[var(--shadow-raised)]">
      <div className="flex items-center gap-2 bg-[var(--color-warn)] px-4 py-2.5 text-white">
        <BellRing className="size-5 shrink-0 animate-[pulse_1.5s_ease-in-out_3]" />
        <span className="flex-1 text-sm font-bold tracking-tight">Vandaag online zetten</span>
        <button type="button" onClick={dismiss} aria-label="Sluiten" className="rounded p-0.5 hover:bg-white/20">
          <X className="size-4" />
        </button>
      </div>
      <div className="p-3">
        <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
          Let op — deze {posts.length === 1 ? "post moet" : "posts moeten"} vandaag online bij de klant. Niet vergeten te posten.
        </p>
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href="/calendar" className="flex items-center gap-2 rounded-[var(--radius-sm)] border-l-[3px] border-[var(--color-warn)] bg-[var(--color-surface-sunken)] px-2.5 py-1.5 text-sm hover:bg-[var(--color-surface-2)]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.clientName}</span>
                  <span className="block truncate text-xs text-[var(--color-ink-muted)]">{p.title}</span>
                </span>
                {p.at ? <span className="shrink-0 text-2xs font-medium tabular-nums text-[var(--color-ink-faint)]">{p.at.slice(0, 5)}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/calendar" className="mt-2 block text-center text-xs font-medium text-[var(--color-brand-600)] hover:underline">Open contentplanning →</Link>
      </div>
    </div>
  );
}
