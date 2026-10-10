"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, X } from "lucide-react";

export type Signal = {
  id: string;
  severity: "urgent" | "warn";
  title: string;
  detail: string;
  href: string;
};

/**
 * Slimme pop-up meldingen op het dashboard. Toont urgente situaties zodra een
 * medewerker het dashboard gebruikt. Een melding kan worden gesloten (gezien) —
 * dan blijft die de rest van de dag verborgen, zodat niemand dezelfde melding
 * steeds opnieuw krijgt. Urgente meldingen (rood) komen terug zolang de situatie
 * niet is opgelost, omdat ze uit de live-gegevens worden opgebouwd.
 */
function todayKey(): string {
  return `sc-dismissed-signals:${new Date().toISOString().slice(0, 10)}`;
}
function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(todayKey()) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function AttentionPopups({ signals }: { signals: Signal[] }) {
  const [dismissed, setDismissed] = useState<Set<string> | null>(null);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev ?? []);
      next.add(id);
      try {
        localStorage.setItem(todayKey(), JSON.stringify([...next]));
      } catch {
        /* private modus e.d. — niet erg */
      }
      return next;
    });
  }

  // Pas renderen na mount (localStorage gelezen), zodat niets flikkert.
  if (dismissed === null) return null;
  const visible = signals.filter((s) => !dismissed.has(s.id)).slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2">
      {visible.map((s) => {
        const urgent = s.severity === "urgent";
        return (
          <div
            key={s.id}
            className="pointer-events-auto overflow-hidden rounded-[var(--radius-md)] border bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
            style={{ borderColor: urgent ? "var(--color-bad)" : "var(--color-warn)" }}
          >
            <div
              className="flex items-center gap-2 px-3 py-2 text-white"
              style={{ background: urgent ? "var(--color-bad)" : "var(--color-warn)" }}
            >
              {urgent ? <AlertTriangle className="size-4 shrink-0" strokeWidth={2.25} /> : <Bell className="size-4 shrink-0" />}
              <span className="flex-1 truncate text-sm font-bold">{s.title}</span>
              <button type="button" onClick={() => dismiss(s.id)} className="rounded p-0.5 text-white/80 hover:text-white" aria-label="Sluiten">
                <X className="size-4" />
              </button>
            </div>
            <div className="px-3 py-2.5">
              <p className="text-sm text-[var(--color-ink)]">{s.detail}</p>
              <div className="mt-2 flex items-center gap-3">
                <Link href={s.href} className="text-xs font-semibold text-[var(--color-brand-600)] hover:underline">
                  Bekijken →
                </Link>
                <button type="button" onClick={() => dismiss(s.id)} className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]">
                  Gezien
                </button>
                {urgent ? <span className="ml-auto text-2xs text-[var(--color-bad)]">blijft tot opgelost</span> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
