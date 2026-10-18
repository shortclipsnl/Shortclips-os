"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ClientLogo } from "@/components/ui";

export type AgendaShoot = {
  id: string;
  title: string;
  scheduledOn: string; // YYYY-MM-DD
  startTime: string | null;
  locationName: string | null;
  status: string;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  videographerName: string | null;
};

/** Volle kleur per opnamestatus — zodat de planning in kleur scanbaar is. */
const STATUS_COLOR: Record<string, string> = {
  concept: "var(--color-ink-faint)",
  planned: "var(--color-info)",
  confirmed: "var(--color-lime)",
  in_progress: "var(--color-brand-600)",
  completed: "var(--color-good)",
  cancelled: "var(--color-bad)",
};
const STATUS_LABEL: Record<string, string> = {
  concept: "Concept",
  planned: "Gepland",
  confirmed: "Bevestigd",
  in_progress: "Bezig",
  completed: "Afgerond",
  cancelled: "Geannuleerd",
};

const WEEKDAYS_LONG = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const WEEKDAYS_SHORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];

const iso = (d: Date) => d.toLocaleDateString("en-CA");
function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((t.getTime() - first.getTime()) / 6048e5);
}

export function ShootAgenda({ shoots, initialDate }: { shoots: AgendaShoot[]; initialDate?: string }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [view, setView] = useState<"week" | "maand">("week");
  // Start op de week van de eerstvolgende opname (initialDate) als die er is —
  // zodat je niet op een lege "deze week" landt. Anders gewoon vandaag.
  const [anchor, setAnchor] = useState<Date>(() => {
    if (initialDate) { const [y, m, d] = initialDate.slice(0, 10).split("-").map(Number); if (y) return new Date(y, (m ?? 1) - 1, d); }
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });

  const byDate = useMemo(() => {
    const m = new Map<string, AgendaShoot[]>();
    for (const s of shoots) {
      const k = s.scheduledOn.slice(0, 10);
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    return m;
  }, [shoots]);

  const todayIso = iso(today);
  const shift = (dir: -1 | 1) => {
    setAnchor((a) => {
      const d = new Date(a);
      if (view === "week") d.setDate(d.getDate() + dir * 7);
      else d.setMonth(d.getMonth() + dir);
      return d;
    });
  };

  // Periodelabel + dagen.
  const monday = mondayOf(anchor);
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  const periodLabel =
    view === "week"
      ? `Week ${isoWeek(monday)} · ${weekDays[0]!.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })} – ${weekDays[6]!.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`
      : anchor.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

  return (
    <div>
      {/* Navigatiebalk */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] p-0.5">
          {(["week", "maand"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-[calc(var(--radius-sm)-2px)] px-3 py-1 text-xs font-semibold capitalize ${view === v ? "bg-[var(--color-ink)] text-white" : "text-[var(--color-ink-muted)]"}`}>
              {v}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <button onClick={() => shift(-1)} aria-label="Vorige" className="grid size-7 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => shift(1)} aria-label="Volgende" className="grid size-7 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <span className="text-sm font-bold capitalize">{periodLabel}</span>
        <div className="ml-auto flex flex-wrap gap-1 text-xs">
          <QuickBtn onClick={() => { setView("week"); setAnchor(new Date(today)); }}>Deze week</QuickBtn>
          <QuickBtn onClick={() => { setView("week"); const d = new Date(today); d.setDate(d.getDate() + 7); setAnchor(d); }}>Volgende week</QuickBtn>
          <QuickBtn onClick={() => { setView("maand"); setAnchor(new Date(today)); }}>Deze maand</QuickBtn>
          <QuickBtn onClick={() => { setView("maand"); const d = new Date(today); d.setMonth(d.getMonth() + 1); setAnchor(d); }}>Volgende maand</QuickBtn>
        </div>
      </div>

      {view === "week" ? (
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-7">
          {weekDays.map((d, i) => {
            const key = iso(d);
            const isToday = key === todayIso;
            const items = byDate.get(key) ?? [];
            return (
              <div key={key} className="min-w-0 bg-[var(--color-surface)]">
                <div className={`px-2 pt-2 pb-1.5 ${isToday ? "bg-[var(--color-brand-600)] text-white" : ""}`}>
                  <div className="text-sm font-bold capitalize">{WEEKDAYS_LONG[i]}</div>
                  <div className={`text-2xs ${isToday ? "text-white/80" : "text-[var(--color-ink-faint)]"}`}>
                    {d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}{isToday ? " · vandaag" : ""}
                  </div>
                </div>
                <div className="space-y-1.5 p-1.5">
                  {items.length === 0 ? (
                    <p className="px-1 py-2 text-2xs text-[var(--color-ink-faint)]">—</p>
                  ) : (
                    items.map((s) => <ShootCard key={s.id} s={s} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <MonthGrid anchor={anchor} byDate={byDate} todayIso={todayIso} />
      )}
    </div>
  );
}

function QuickBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
      {children}
    </button>
  );
}

function ShootCard({ s }: { s: AgendaShoot }) {
  const color = STATUS_COLOR[s.status] ?? "var(--color-ink-faint)";
  return (
    <Link href={`/productions/${s.id}`}
      className="block rounded-[var(--radius-sm)] border-l-[3px] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-card)] hover:brightness-[0.99]"
      style={{ borderLeftColor: color }}>
      <span className="flex items-center gap-1.5">
        <ClientLogo name={s.clientName} logoUrl={s.clientLogo} color={s.clientColor} size={16} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{s.clientName}</span>
      </span>
      <span className="mt-0.5 flex items-center justify-between gap-1 text-[10px] text-[var(--color-ink-muted)]">
        <span className="truncate">{s.startTime ? s.startTime.slice(0, 5) : "hele dag"}{s.videographerName ? ` · ${s.videographerName.split(" ")[0]}` : ""}</span>
        <span className="shrink-0 font-semibold" style={{ color }}>{STATUS_LABEL[s.status] ?? s.status}</span>
      </span>
    </Link>
  );
}

function MonthGrid({ anchor, byDate, todayIso }: { anchor: Date; byDate: Map<string, AgendaShoot[]>; todayIso: string }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = mondayOf(first);
  const month = anchor.getMonth();
  const weeks = Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => { const x = new Date(gridStart); x.setDate(gridStart.getDate() + w * 7 + d); return x; }),
  );
  // Laat een lege laatste week weg.
  const visibleWeeks = weeks.filter((wk) => wk.some((x) => x.getMonth() === month));

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
      <div className="grid grid-cols-7 bg-[var(--color-surface-sunken)] text-center text-2xs font-semibold uppercase text-[var(--color-ink-faint)]">
        {WEEKDAYS_SHORT.map((w) => <div key={w} className="py-1.5">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px bg-[var(--color-line)]">
        {visibleWeeks.flat().map((d) => {
          const key = iso(d);
          const inMonth = d.getMonth() === month;
          const isToday = key === todayIso;
          const items = byDate.get(key) ?? [];
          return (
            <div key={key} className={`min-h-[76px] min-w-0 p-1 ${inMonth ? "bg-[var(--color-surface)]" : "bg-[var(--color-surface-2)]"}`}>
              <div className={`mb-0.5 text-2xs font-semibold ${isToday ? "inline-grid size-5 place-items-center rounded-full bg-[var(--color-brand-600)] text-white" : inMonth ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]"}`}>
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((s) => (
                  <Link key={s.id} href={`/productions/${s.id}`} title={`${s.clientName}${s.startTime ? ` · ${s.startTime.slice(0, 5)}` : ""}`}
                    className="flex items-center gap-1 truncate rounded-sm px-1 py-0.5 text-[10px] font-medium hover:brightness-95"
                    style={{ background: `color-mix(in srgb, ${STATUS_COLOR[s.status] ?? "var(--color-ink-faint)"} 14%, var(--color-surface))` }}>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[s.status] ?? "var(--color-ink-faint)" }} />
                    <span className="truncate">{s.startTime ? `${s.startTime.slice(0, 5)} ` : ""}{s.clientName}</span>
                  </Link>
                ))}
                {items.length > 3 ? <span className="px-1 text-[10px] text-[var(--color-ink-faint)]">+{items.length - 3} meer</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
