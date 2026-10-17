"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Palmtree } from "lucide-react";

type PlanItem = { id: string; kind: "opname" | "oplevering" | "publicatie"; date: string; clientName: string; clientColor: string | null; title: string; person: string | null; href: string };
type PlanWeek = { key: string; label: string; opnames: PlanItem[]; opleveringen: PlanItem[]; publicaties: PlanItem[]; conflicts: Array<{ editor: string; count: number }>; leave: Array<{ name: string; startOn: string; endOn: string }> };

const KINDS = [
  { key: "opname", label: "Opnames", color: "var(--color-brand-500)" },
  { key: "oplevering", label: "Opleveringen", color: "var(--color-warn)" },
  { key: "publicatie", label: "Publicaties", color: "var(--color-good)" },
] as const;

function fmtDay(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" });
}

export function PlanningBoard({ weeks, clientOptions }: { weeks: PlanWeek[]; clientOptions: string[] }) {
  const [client, setClient] = useState("alle");
  const [kinds, setKinds] = useState<Record<string, boolean>>({ opname: true, oplevering: true, publicatie: true });

  const filterItems = (items: PlanItem[]) => items.filter((i) => client === "alle" || i.clientName === client);

  const view = useMemo(() => weeks.map((w) => ({
    ...w,
    opnames: kinds.opname ? filterItems(w.opnames) : [],
    opleveringen: kinds.oplevering ? filterItems(w.opleveringen) : [],
    publicaties: kinds.publicatie ? filterItems(w.publicaties) : [],
  })), [weeks, client, kinds]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
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
        {view.map((w) => {
          const total = w.opnames.length + w.opleveringen.length + w.publicaties.length;
          return (
            <div key={w.key} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-2">
                <span className="text-sm font-semibold">{w.label}</span>
                <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-2xs font-medium text-[var(--color-ink-muted)]">{total}</span>
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
              </div>
              {total === 0 ? (
                <p className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">Niets gepland in deze week.</p>
              ) : (
                <div className="grid gap-px bg-[var(--color-line)] sm:grid-cols-3">
                  {KINDS.map((k) => {
                    const list = (k.key === "opname" ? w.opnames : k.key === "oplevering" ? w.opleveringen : w.publicaties);
                    return (
                      <div key={k.key} className="bg-[var(--color-surface)] p-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                          <span className="size-2 rounded-full" style={{ background: k.color }} />{k.label} ({list.length})
                        </div>
                        {list.length === 0 ? <p className="text-2xs text-[var(--color-ink-faint)]">—</p> : (
                          <ul className="space-y-1">
                            {list.map((i) => (
                              <li key={i.id}>
                                <Link href={i.href} className="block rounded px-1 py-0.5 text-xs hover:bg-[var(--color-surface-sunken)]">
                                  <span className="font-medium tabular-nums text-[var(--color-ink-muted)]">{fmtDay(i.date)}</span>{" "}
                                  <span className="font-medium">{i.clientName}</span>
                                  {i.person ? <span className="text-[var(--color-ink-faint)]"> · {i.person.split(" ")[0]}</span> : null}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
