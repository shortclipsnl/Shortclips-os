"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle2, Palmtree, Presentation, Send } from "lucide-react";
import { ClientLogo } from "@/components/ui";

type PlanItem = { id: string; kind: "opname" | "oplevering" | "publicatie"; date: string; clientName: string; clientColor: string | null; clientLogo: string | null; title: string; person: string | null; href: string };
type PlanMeeting = { id: string; title: string; date: string; time: string; location: string | null };
type PlanWeek = { key: string; label: string; weekNumber: number; startOn: string; endOn: string; opnames: PlanItem[]; opleveringen: PlanItem[]; publicaties: PlanItem[]; meetings: PlanMeeting[]; conflicts: Array<{ editor: string; count: number }>; leave: Array<{ name: string; startOn: string; endOn: string }> };

type Kind = "opname" | "oplevering" | "publicatie" | "meeting";

const KINDS: { key: Kind; label: string; color: string; Icon: typeof Camera }[] = [
  { key: "opname", label: "Opnames", color: "var(--color-brand-600)", Icon: Camera },
  { key: "oplevering", label: "Opleveringen", color: "var(--color-warn)", Icon: CheckCircle2 },
  { key: "publicatie", label: "Publicaties", color: "var(--color-good)", Icon: Send },
  { key: "meeting", label: "Meetings", color: "var(--color-violet)", Icon: Presentation },
];
const KIND_COLOR: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.color])) as Record<Kind, string>;

/** Eén regel in de dag-agenda, los van het soort. */
type AgendaItem = {
  id: string;
  kind: Kind;
  main: string;
  sub: string | null;
  time: string | null;
  href: string;
  clientName: string | null;
  clientColor: string | null;
  clientLogo: string | null;
};

const todayIso = new Date().toLocaleDateString("en-CA");

/** "woensdag 22 okt" uit een YYYY-MM-DD. */
function dayLabel(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "short" });
}

export function PlanningBoard({ weeks, clientOptions }: { weeks: PlanWeek[]; clientOptions: string[] }) {
  const [client, setClient] = useState("alle");
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ opname: true, oplevering: true, publicatie: true, meeting: true });

  // Per week de items per dag bundelen (agenda-weergave).
  const view = useMemo(() => {
    const matchesClient = (name: string | null) => client === "alle" || name === client;
    const toItem = (i: PlanItem, kind: Kind): AgendaItem => ({
      id: i.id,
      kind,
      main: kind === "opname" ? i.clientName : i.title,
      sub: kind === "opname" ? (i.person ?? null) : [i.clientName, i.person].filter(Boolean).join(" · ") || null,
      time: null,
      href: i.href,
      clientName: i.clientName,
      clientColor: i.clientColor,
      clientLogo: i.clientLogo,
    });

    return weeks.map((w) => {
      const byDate = new Map<string, AgendaItem[]>();
      const push = (date: string, item: AgendaItem) => {
        const list = byDate.get(date) ?? [];
        list.push(item);
        byDate.set(date, list);
      };
      if (kinds.opname) w.opnames.filter((i) => matchesClient(i.clientName)).forEach((i) => push(i.date, toItem(i, "opname")));
      if (kinds.oplevering) w.opleveringen.filter((i) => matchesClient(i.clientName)).forEach((i) => push(i.date, toItem(i, "oplevering")));
      if (kinds.publicatie) w.publicaties.filter((i) => matchesClient(i.clientName)).forEach((i) => push(i.date, toItem(i, "publicatie")));
      if (kinds.meeting && client === "alle") {
        w.meetings.forEach((m) => push(m.date, { id: m.id, kind: "meeting", main: m.title, sub: m.location, time: m.time, href: "/meetings", clientName: null, clientColor: null, clientLogo: null }));
      }
      const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, items }));
      const total = days.reduce((n, d) => n + d.items.length, 0);
      return { ...w, days, total };
    });
  }, [weeks, client, kinds]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button key={k.key} onClick={() => setKinds((s) => ({ ...s, [k.key]: !s[k.key] }))}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${kinds[k.key] ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>
              <span className="size-2 rounded-full" style={{ background: k.color }} />{k.label}
            </button>
          ))}
        </div>
        <select className="sc-input ml-auto h-8 w-auto py-0 text-xs" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Klant">
          <option value="alle">Alle klanten</option>
          {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="space-y-4">
        {view.map((w) => (
          <div key={w.key} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
            <WeekHeader w={w} count={w.total}>
              {w.conflicts.map((c) => (
                <span key={c.editor} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-2xs font-medium text-[#a3271c]">
                  <AlertTriangle className="size-3" /> {c.editor}: {c.count} opleveringen
                </span>
              ))}
              {w.leave.map((l) => (
                <span key={l.name + l.startOn} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-2xs font-medium text-[#8a5300]">
                  <Palmtree className="size-3" /> {l.name.split(" ")[0]} afwezig
                </span>
              ))}
            </WeekHeader>

            {w.days.length === 0 ? (
              <p className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">Niets gepland in deze week.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {w.days.map((d) => {
                  const isToday = d.date === todayIso;
                  return (
                    <li key={d.date} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:gap-3">
                      {/* Daglabel */}
                      <div className={`shrink-0 pt-0.5 text-xs font-bold capitalize sm:w-36 ${isToday ? "text-[var(--color-brand-700)]" : "text-[var(--color-ink)]"}`}>
                        {dayLabel(d.date)}
                        {isToday ? <span className="ml-1 rounded bg-[var(--color-brand-600)] px-1 py-0.5 text-[10px] font-bold text-white">vandaag</span> : null}
                      </div>
                      {/* Items van die dag */}
                      <div className="min-w-0 flex-1 space-y-1">
                        {d.items.map((it) => (
                          <Link key={`${it.kind}-${it.id}`} href={it.href}
                            className="flex items-center gap-2 rounded-[var(--radius-sm)] border-l-[3px] bg-[var(--color-surface)] px-2 py-1 text-xs hover:bg-[var(--color-surface-sunken)]"
                            style={{ borderLeftColor: KIND_COLOR[it.kind] }}>
                            <KindIcon kind={it.kind} />
                            {it.clientName ? <ClientLogo name={it.clientName} logoUrl={it.clientLogo} color={it.clientColor} size={16} /> : null}
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-semibold">{it.main}</span>
                              {it.sub ? <span className="text-[var(--color-ink-muted)]"> · {it.sub}</span> : null}
                            </span>
                            {it.time ? <span className="shrink-0 tabular-nums text-[var(--color-ink-faint)]">{it.time}</span> : null}
                          </Link>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: Kind }) {
  const k = KINDS.find((x) => x.key === kind)!;
  const Icon = k.Icon;
  return <Icon className="size-3.5 shrink-0" style={{ color: k.color }} strokeWidth={2} />;
}

/** Weekkop met weeknummer + datumbereik + telling. */
function WeekHeader({ w, count, children }: { w: PlanWeek; count: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-2">
      <span className="rounded bg-[var(--color-brand-600)] px-1.5 py-0.5 text-2xs font-bold tabular-nums text-white">W{w.weekNumber}</span>
      <span className="text-sm font-semibold">{w.label}</span>
      <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-2xs font-medium text-[var(--color-ink-muted)]">{count}</span>
      {children}
    </div>
  );
}
