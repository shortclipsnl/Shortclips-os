"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Clock, ListChecks, Users } from "lucide-react";
import type { MorningRow } from "@/server/morning-overview";

type Tone = "bad" | "warn" | "info" | "neutral";

export type MorningTile = {
  key: string;
  label: string;
  value: number;
  tone: Tone;
  rows: MorningRow[];
  /** Optionele link naar de volledige (gefilterde) lijst. */
  allHref?: string;
  allLabel?: string;
};

const ICONS: Record<string, React.ReactNode> = {
  overdue: <AlertTriangle className="size-4" />,
  atClient: <Clock className="size-4" />,
  myTasks: <ListChecks className="size-4" />,
  late: <Users className="size-4" />,
};

function toneColor(tone: Tone, active: boolean): string {
  if (!active) return "var(--color-ink-muted)";
  return tone === "bad" ? "var(--color-bad)" : tone === "warn" ? "var(--color-warn)" : tone === "info" ? "var(--color-info)" : "var(--color-ink)";
}

/**
 * De vier ochtend-tegels. Klik op een tegel met een telling > 0 en het
 * detailpaneel eronder toont precies welke problemen/aandachtspunten achter dat
 * getal zitten (elk item doorklikbaar). Zo zie je direct wat er aandacht vraagt.
 */
export function MorningTiles({ tiles }: { tiles: MorningTile[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const openTile = tiles.find((t) => t.key === open) ?? null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {tiles.map((tl) => {
          const hasItems = tl.value > 0;
          const active = open === tl.key;
          const color = toneColor(tl.tone, hasItems);
          const boxStyle = hasItems ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined;
          return (
            <button
              key={tl.key}
              type="button"
              disabled={!hasItems}
              aria-expanded={active}
              onClick={() => setOpen(active ? null : tl.key)}
              className={`flex items-center gap-3 rounded-[var(--radius-md)] border bg-[var(--color-surface)] px-3.5 py-3 text-left transition ${active ? "border-[var(--color-brand-500)]" : "border-[var(--color-line)]"} ${hasItems ? "cursor-pointer hover:border-[var(--color-brand-500)]" : "cursor-default"}`}
              style={boxStyle}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
                {ICONS[tl.key]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-2xl font-bold tabular-nums leading-none" style={{ color }}>{tl.value}</span>
                <span className="mt-0.5 block text-2xs text-[var(--color-ink-muted)]">{tl.label}</span>
              </span>
              {hasItems ? (
                <ChevronDown className={`size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform ${active ? "rotate-180" : ""}`} />
              ) : null}
            </button>
          );
        })}
      </div>

      {openTile && openTile.rows.length > 0 ? (
        <div className="mt-3 border-t border-[var(--color-line)] pt-3">
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{openTile.label}</p>
          <ul className="space-y-1">
            {openTile.rows.map((r) => {
              const content = (
                <>
                  <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">{r.label}</span>
                  {r.sub ? <span className="shrink-0 text-2xs font-semibold text-[var(--color-ink-muted)]">{r.sub}</span> : null}
                </>
              );
              return (
                <li key={r.id}>
                  {r.href ? (
                    <Link href={r.href} className="flex items-center justify-between gap-2 text-sm hover:underline">{content}</Link>
                  ) : (
                    <span className="flex items-center justify-between gap-2 text-sm">{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {openTile.allHref ? (
            <Link href={openTile.allHref} className="mt-2 inline-block text-2xs font-semibold text-[var(--color-brand-600)] hover:underline">
              {openTile.allLabel ?? "Alles bekijken"} →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
