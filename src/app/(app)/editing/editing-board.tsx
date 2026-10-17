"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import { VIDEO_STATUS, type VideoStage } from "@/lib/statuses";
import type { EditingProject } from "@/server/editing";

/** Het 4-kleurensysteem uit de opdracht. Kleur + duidelijke naam. */
const BUCKETS = [
  { key: "aandacht", label: "Vraagt aandacht", color: "var(--color-bad)", hint: "Over de deadline" },
  { key: "editor", label: "Bij de editor / in productie", color: "var(--color-brand-500)", hint: "In bewerking" },
  { key: "klant", label: "Wacht op klant", color: "var(--color-warn)", hint: "Ter beoordeling bij de klant" },
  { key: "afgerond", label: "Afgerond", color: "var(--color-good)", hint: "Klaar of gepubliceerd" },
] as const;

const DEADLINE_FILTERS = [
  { key: "alle", label: "Alle" },
  { key: "te-laat", label: "Te laat" },
  { key: "deze-week", label: "Deze week" },
] as const;

function deadlineText(p: EditingProject): { text: string; tone: "bad" | "warn" | "muted" } {
  if (p.isLate) return { text: `${Math.abs(p.daysToDeadline ?? 0)} dag${Math.abs(p.daysToDeadline ?? 0) === 1 ? "" : "en"} te laat`, tone: "bad" };
  if (p.daysToDeadline == null) return { text: "geen deadline", tone: "muted" };
  if (p.daysToDeadline === 0) return { text: "vandaag", tone: "warn" };
  if (p.daysToDeadline === 1) return { text: "morgen", tone: "warn" };
  return { text: `over ${p.daysToDeadline} dagen`, tone: p.daysToDeadline <= 3 ? "warn" : "muted" };
}

export function EditingBoard({ projects, editorOptions, clientOptions }: { projects: EditingProject[]; editorOptions: string[]; clientOptions: string[] }) {
  const [editor, setEditor] = useState("alle");
  const [client, setClient] = useState("alle");
  const [deadline, setDeadline] = useState<string>("alle");
  const [showDone, setShowDone] = useState(false);

  const filtered = useMemo(() => projects.filter((p) => {
    if (editor !== "alle" && (p.editorName ?? "—") !== editor) return false;
    if (client !== "alle" && p.clientName !== client) return false;
    if (deadline === "te-laat" && !p.isLate) return false;
    if (deadline === "deze-week" && !(p.daysToDeadline != null && p.daysToDeadline >= 0 && p.daysToDeadline <= 7)) return false;
    return true;
  }), [projects, editor, client, deadline]);

  const byBucket = useMemo(() => {
    const m: Record<string, EditingProject[]> = { aandacht: [], editor: [], klant: [], afgerond: [] };
    for (const p of filtered) m[p.bucket]!.push(p);
    return m;
  }, [filtered]);

  return (
    <div>
      {/* Legenda + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-3 text-2xs text-[var(--color-ink-muted)]">
          {BUCKETS.map((b) => (
            <span key={b.key} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: b.color }} />{b.label}
            </span>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {DEADLINE_FILTERS.map((f) => (
              <button key={f.key} onClick={() => setDeadline(f.key)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${deadline === f.key ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>
                {f.label}
              </button>
            ))}
          </div>
          <select className="sc-input h-8 w-auto py-0 text-xs" value={editor} onChange={(e) => setEditor(e.target.value)} aria-label="Editor">
            <option value="alle">Alle editors</option>
            {editorOptions.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select className="sc-input h-8 w-auto py-0 text-xs" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Klant">
            <option value="alle">Alle klanten</option>
            {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {BUCKETS.map((b) => {
          const list = byBucket[b.key]!;
          const collapsible = b.key === "afgerond";
          const open = !collapsible || showDone;
          if (list.length === 0 && b.key !== "aandacht") return null;
          return (
            <div key={b.key} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
              <button
                onClick={() => collapsible && setShowDone((s) => !s)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
                style={{ borderLeft: `3px solid ${b.color}` }}
              >
                <span className="text-sm font-semibold">{b.label}</span>
                <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-muted)]">{list.length}</span>
                <span className="text-2xs text-[var(--color-ink-faint)]">{b.hint}</span>
                {collapsible ? <ChevronDown className={`ml-auto size-4 text-[var(--color-ink-faint)] transition-transform ${open ? "rotate-180" : ""}`} /> : null}
              </button>
              {open ? (
                list.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">Niets in deze categorie.</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
                    {list.map((p) => {
                      const d = deadlineText(p);
                      const st = VIDEO_STATUS[p.status as VideoStage];
                      return (
                        <li key={p.id}>
                          <Link href={`/videos/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-sunken)]/50">
                            <span className="size-2 shrink-0 rounded-full" style={{ background: b.color }} />
                            <Avatar name={p.clientName} color={p.clientColor} size={24} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{p.title || "Naamloze video"}</span>
                              <span className="block truncate text-2xs text-[var(--color-ink-faint)]">{p.clientName} · {p.editorName ?? "geen editor"}</span>
                            </span>
                            {st ? <Badge tone={st.tone}>{st.short}</Badge> : null}
                            <span className={`w-28 shrink-0 text-right text-xs font-medium ${d.tone === "bad" ? "text-[var(--color-bad)]" : d.tone === "warn" ? "text-[var(--color-warn)]" : "text-[var(--color-ink-faint)]"}`}>{d.text}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
