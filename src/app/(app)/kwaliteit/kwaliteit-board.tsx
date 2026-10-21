"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, type Tone } from "@/components/ui";
import type { QualityItem, QualitySeverity } from "@/server/quality";

/**
 * Drie knoppen naast elkaar — Directe actie, Extra aandacht, Vooruit kijken —
 * die als tabs werken: klik op een knop en je ziet eronder uitsluitend de punten
 * van die ernst. Zo blijft het overzichtelijk (één lijst tegelijk) en kan het
 * team in één oogopslag scannen waar het meeste werk ligt.
 */
const TABS: { severity: QualitySeverity; label: string; tone: Tone; color: string }[] = [
  { severity: "rood", label: "Directe actie", tone: "bad", color: "var(--color-bad)" },
  { severity: "oranje", label: "Extra aandacht", tone: "warn", color: "var(--color-warn)" },
  { severity: "blauw", label: "Vooruit kijken", tone: "info", color: "var(--color-info)" },
];

export function KwaliteitBoard({
  items,
  counts,
}: {
  items: QualityItem[];
  counts: Record<QualitySeverity, number>;
}) {
  const [active, setActive] = useState<QualitySeverity>("rood");
  const current = TABS.find((t) => t.severity === active)!;
  const bucket = items.filter((i) => i.severity === active);

  return (
    <div>
      {/* Drie knoppen naast elkaar. De actieve knop is in zijn eigen kleur
          gevuld; de rest staat rustig, zodat meteen duidelijk is wat je bekijkt. */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        {TABS.map((t) => {
          const on = t.severity === active;
          const n = counts[t.severity];
          return (
            <button
              key={t.severity}
              type="button"
              onClick={() => setActive(t.severity)}
              aria-pressed={on}
              className={`flex flex-col items-start gap-0.5 rounded-[var(--radius-md)] border px-3 py-3 text-left transition sm:px-4 ${
                on ? "text-white shadow-[var(--shadow-card)]" : "bg-[var(--color-surface)] hover:border-[var(--color-line-strong)]"
              }`}
              style={on ? { background: t.color, borderColor: t.color } : { borderColor: "var(--color-line)" }}
            >
              <span
                className={`text-2xl font-bold tabular-nums ${on ? "text-white" : ""}`}
                style={on ? undefined : { color: t.color }}
              >
                {n}
              </span>
              <span className={`text-xs font-semibold ${on ? "text-white/90" : "text-[var(--color-ink-muted)]"}`}>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Punten van de gekozen knop. */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <div className="flex items-center justify-between gap-2 px-5 py-2.5 text-white" style={{ background: current.color }}>
          <h2 className="text-sm font-bold tracking-tight">{current.label}</h2>
          <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold tabular-nums">{counts[active]}</span>
        </div>
        {bucket.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-muted)]">Niets hier — mooi!</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {bucket.map((i) => (
              <li key={i.id}>
                <Link href={i.href} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-sunken)]/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--color-ink)]">{i.title}</span>
                    <span className="block truncate text-xs text-[var(--color-ink-muted)]">{i.detail}</span>
                  </span>
                  <Badge tone={current.tone} className="shrink-0">{i.category}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
