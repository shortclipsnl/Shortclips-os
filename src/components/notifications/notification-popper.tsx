"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, X } from "lucide-react";
import { fetchNewNotifications, markNotificationRead, snoozeNotification, type PopNotification } from "@/server/actions/notifications";

const ACCENT: Record<PopNotification["level"], string> = {
  info: "var(--color-info)",
  success: "var(--color-good)",
  warning: "var(--color-warn)",
  critical: "var(--color-bad)",
};

// Eén gedeelde audiocontext die we "opwarmen" bij de eerste interactie, zodat het
// geluid daarna mag afspelen (browsers blokkeren geluid zonder gebruikersactie).
let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Kort, vriendelijk "ding-ding" bij een nieuwe melding. */
function playDing() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.13;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  } catch {
    /* geluid is optioneel */
  }
}

/**
 * Laat nieuwe meldingen realtime als toast rechtsboven oppoppen, met een geluidje,
 * zodat ze echt opvallen. Pollt elke ~25s op nieuwe ongelezen meldingen van de
 * ingelogde gebruiker (werkt voor het hele team én editors). Elke melding popt
 * precies één keer (baseline wordt per gebruiker bewaard).
 */
export function NotificationPopper({ viewerId }: { viewerId: string }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<PopNotification[]>([]);
  const sinceRef = useRef<string>(new Date().toISOString());
  const key = `scnotif:since:${viewerId}`;

  useEffect(() => {
    // Baseline uit opslag zodat oude meldingen na een refresh niet opnieuw poppen.
    try {
      const saved = localStorage.getItem(key);
      if (saved && !Number.isNaN(Date.parse(saved))) sinceRef.current = saved;
    } catch {
      /* zonder opslag is "nu" de baseline */
    }
    // Audio opwarmen bij de eerste interactie.
    const warm = () => getAudioCtx();
    window.addEventListener("pointerdown", warm, { once: true });
    window.addEventListener("keydown", warm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", warm);
      window.removeEventListener("keydown", warm);
    };
  }, [key]);

  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    let res: { items: PopNotification[]; since: string };
    try {
      res = await fetchNewNotifications(sinceRef.current);
    } catch {
      return;
    }
    // Baseline alleen opschuiven voor écht nieuwe meldingen (server bepaalt dit).
    if (res.since !== sinceRef.current) {
      sinceRef.current = res.since;
      try {
        localStorage.setItem(key, sinceRef.current);
      } catch {
        /* ignore */
      }
    }
    if (res.items.length === 0) return;
    // Niet dubbel tonen wat al op het scherm staat (bijv. een verlopen snooze).
    setToasts((t) => {
      const shown = new Set(t.map((x) => x.id));
      const add = res.items.filter((n) => !shown.has(n.id));
      if (add.length === 0) return t;
      playDing();
      return [...add, ...t].slice(0, 5);
    });
    // Geen automatische verdwijntijd meer: de melding blijft staan tot je 'm
    // wegklikt (kruisje) of uitstelt ("herinner me later"), zodat hij niet
    // ongemerkt verdwijnt en ook niet steeds opnieuw opduikt.
  }, [key]);

  useEffect(() => {
    const first = setTimeout(poll, 4000);
    const iv = setInterval(poll, 25_000);
    const onVis = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [poll]);

  function open(n: PopNotification) {
    dismiss(n.id);
    void markNotificationRead(n.id).catch(() => {});
    if (n.href) router.push(n.href);
    router.refresh();
  }

  // Wegklikken (kruisje): markeer als gelezen — de melding komt niet meer terug.
  function close(n: PopNotification) {
    dismiss(n.id);
    void markNotificationRead(n.id).catch(() => {});
    router.refresh();
  }

  // Uitstellen: verberg nu, kom over 30 minuten nog één keer terug.
  function snooze(n: PopNotification) {
    dismiss(n.id);
    void snoozeNotification(n.id, 30).catch(() => {});
  }

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((n) => (
        <div
          key={n.id}
          className="pointer-events-auto relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)] [animation:scNotifIn_.22s_ease-out]"
          style={{ borderLeft: `4px solid ${ACCENT[n.level]}` }}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => open(n)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") open(n);
            }}
            className="cursor-pointer px-4 py-3 pr-9 hover:bg-[var(--color-surface-sunken)]/60"
          >
            <div className="flex items-start gap-2">
              <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: ACCENT[n.level] }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--color-ink)]">{n.title}</span>
                {n.body ? <span className="mt-0.5 block line-clamp-3 text-xs text-[var(--color-ink-muted)]">{n.body}</span> : null}
                {n.href ? <span className="mt-1 block text-2xs font-semibold text-[var(--color-brand-600)]">Bekijken →</span> : null}
              </span>
            </div>
          </div>
          {/* Uitstellen: komt over 30 min nog één keer terug. */}
          <div className="flex items-center gap-2 border-t border-[var(--color-line)] px-4 py-1.5">
            <button
              type="button"
              onClick={() => snooze(n)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            >
              <Clock className="size-3" /> Herinner me over 30 min
            </button>
          </div>
          <button
            type="button"
            onClick={() => close(n)}
            aria-label="Melding wegklikken"
            className="absolute right-2 top-2 rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
