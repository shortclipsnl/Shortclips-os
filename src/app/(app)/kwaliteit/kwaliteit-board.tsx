"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PenLine, Scissors, MessagesSquare, CalendarRange, LayoutGrid, Dot } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import type { QualityItem, QualityGroup, QualitySeverity } from "@/server/quality";

/**
 * De aandachtspunten ingedeeld per ACTIEGEBIED — Scripting, Video editing,
 * Klantcontact en Opnames & planning — want daar stuurt het team op. Je kiest een
 * gebied (of "Alles") en ziet per gebied de punten, met een kleur voor de ernst
 * (rood = directe actie, oranje = extra aandacht, blauw = vooruitkijken).
 */
const SEV: Record<QualitySeverity, { tone: Tone; color: string; label: string; rank: number }> = {
  rood: { tone: "bad", color: "var(--color-bad)", label: "Directe actie", rank: 0 },
  oranje: { tone: "warn", color: "var(--color-warn)", label: "Extra aandacht", rank: 1 },
  blauw: { tone: "info", color: "var(--color-info)", label: "Vooruit kijken", rank: 2 },
};

type AreaKey = QualityGroup | "alle";
const AREAS: { key: QualityGroup; label: string; hint: string; icon: typeof PenLine; accent: string }[] = [
  { key: "scripting", label: "Scripting", hint: "Zijn scripts op tijd klaar?", icon: PenLine, accent: "var(--color-brand-600)" },
  { key: "editing", label: "Video editing", hint: "Loopt de editing achter?", icon: Scissors, accent: "var(--color-violet)" },
  { key: "klant", label: "Klantcontact", hint: "Opsturen & herinneren", icon: MessagesSquare, accent: "var(--color-good)" },
  { key: "planning", label: "Opnames & planning", hint: "Agenda vullen", icon: CalendarRange, accent: "var(--color-warn)" },
  { key: "overig", label: "Overig", hint: "Koppelingen, doelen, contracten", icon: LayoutGrid, accent: "var(--color-ink-muted)" },
];

export function KwaliteitBoard({ items }: { items: QualityItem[]; counts: Record<QualitySeverity, number> }) {
  const [area, setArea] = useState<AreaKey>("alle");

  const byGroup = useMemo(() => {
    const m = new Map<QualityGroup, QualityItem[]>();
    for (const a of AREAS) m.set(a.key, []);
    for (const it of items) m.get((it.group ?? "overig"))!.push(it);
    // Binnen een gebied: ernst eerst (rood → blauw).
    for (const list of m.values()) list.sort((x, y) => SEV[x.severity].rank - SEV[y.severity].rank);
    return m;
  }, [items]);

  const redOf = (list: QualityItem[]) => list.filter((i) => i.severity === "rood").length;
  const shownAreas = AREAS.filter((a) => (area === "alle" ? (byGroup.get(a.key)!.length > 0) : a.key === area));

  return (
    <div>
      {/* Actiegebied-knoppen: het aantal punten per gebied, met een rode stip als er directe actie nodig is. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <AreaButton label="Alles" count={items.length} red={items.filter((i) => i.severity === "rood").length} on={area === "alle"} onClick={() => setArea("alle")} icon={LayoutGrid} accent="var(--color-indigo-ink)" />
        {AREAS.map((a) => {
          const list = byGroup.get(a.key)!;
          return (
            <AreaButton key={a.key} label={a.label} hint={a.hint} count={list.length} red={redOf(list)} on={area === a.key} onClick={() => setArea(a.key)} icon={a.icon} accent={a.accent} />
          );
        })}
      </div>

      {items.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] px-5 py-10 text-center text-sm text-[var(--color-ink-muted)]">Niets dat aandacht vraagt — alles loopt op schema. 🎉</p>
      ) : (
        <div className="space-y-5">
          {shownAreas.map((a) => {
            const list = byGroup.get(a.key)!;
            if (list.length === 0) return <EmptyArea key={a.key} label={a.label} accent={a.accent} icon={a.icon} />;
            return (
              <div key={a.key} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-white" style={{ background: a.accent }}>
                  <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight"><a.icon className="size-4" /> {a.label}</h2>
                  <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold tabular-nums">{list.length}</span>
                </div>
                <ul className="divide-y divide-[var(--color-line)]">
                  {list.map((i) => (
                    <li key={i.id}>
                      <Link href={i.href} className="flex items-center gap-2.5 px-4 py-3 hover:bg-[var(--color-surface-sunken)]/50" style={{ boxShadow: `inset 3px 0 0 ${SEV[i.severity].color}` }}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[var(--color-ink)]">{i.title}</span>
                          <span className="block truncate text-xs text-[var(--color-ink-muted)]">{i.detail}</span>
                        </span>
                        <Badge tone={SEV[i.severity].tone} className="hidden shrink-0 sm:inline-flex">{i.category}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* Legenda van de kleuren. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-[var(--color-ink-muted)]">
        {(Object.keys(SEV) as QualitySeverity[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1"><Dot className="size-4" style={{ color: SEV[s].color }} strokeWidth={6} /> {SEV[s].label}</span>
        ))}
      </div>
    </div>
  );
}

function AreaButton({ label, hint, count, red, on, onClick, icon: Icon, accent }: { label: string; hint?: string; count: number; red: number; on: boolean; onClick: () => void; icon: typeof PenLine; accent: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition ${on ? "text-white shadow-[var(--shadow-card)]" : "bg-[var(--color-surface)] hover:border-[var(--color-line-strong)]"}`}
      style={on ? { background: accent, borderColor: accent } : { borderColor: "var(--color-line)" }}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${on ? "text-white/90" : ""}`} style={on ? undefined : { color: accent }} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-lg font-bold tabular-nums">{count}</span>
          {red > 0 ? <span className={`rounded-full px-1.5 py-0.5 text-2xs font-bold ${on ? "bg-white/25 text-white" : "bg-[var(--color-bad-soft)] text-[var(--color-bad)]"}`}>{red} nu</span> : null}
        </span>
        <span className={`block text-xs font-semibold ${on ? "text-white/90" : "text-[var(--color-ink)]"}`}>{label}</span>
        {hint ? <span className={`block truncate text-2xs ${on ? "text-white/70" : "text-[var(--color-ink-faint)]"}`}>{hint}</span> : null}
      </span>
    </button>
  );
}

function EmptyArea({ label, accent, icon: Icon }: { label: string; accent: string; icon: typeof PenLine }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
      <div className="flex items-center gap-2 px-4 py-2.5 text-white" style={{ background: accent }}>
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight"><Icon className="size-4" /> {label}</h2>
      </div>
      <p className="px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">Niets hier — mooi!</p>
    </div>
  );
}
