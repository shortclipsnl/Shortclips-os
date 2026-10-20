"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, ChevronRight, Download, ExternalLink, FileText } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import { daysSince, formatDate, relativeDays, plural } from "@/lib/format";
import { EDIT_PHASE_META, EDIT_PHASE_ORDER, type EditPhase } from "@/lib/statuses";
import { EditorStatusControl } from "../dashboard/editor-status";
import type { EditorBoardVideo } from "@/server/editor-board";

/**
 * Editing-board voor de editor: zijn eigen video's, gegroepeerd per fase. Elke
 * video is één regel met klant, deadline, de fase (zelf te zetten binnen de
 * eigen stappen) en snelkoppelingen naar script, materiaal en Frame.io.
 */
export function EditorBoard({ videos, showEditor = false }: { videos: EditorBoardVideo[]; showEditor?: boolean }) {
  // "Afgerond" standaard ingeklapt — dat is historie, geen werkvoorraad.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["afgerond"]));

  const byPhase = useMemo(() => {
    const m = new Map<EditPhase, EditorBoardVideo[]>();
    for (const ph of EDIT_PHASE_ORDER) m.set(ph, []);
    for (const v of videos) (m.get(v.phase) ?? m.get("te_plannen")!).push(v);
    return m;
  }, [videos]);

  function toggle(ph: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(ph)) n.delete(ph);
      else n.add(ph);
      return n;
    });
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
      {EDIT_PHASE_ORDER.map((ph) => {
        const list = byPhase.get(ph)!;
        const meta = EDIT_PHASE_META[ph];
        const open = !collapsed.has(ph);
        return (
          <div key={ph}>
            <button
              type="button"
              onClick={() => toggle(ph)}
              className="flex w-full items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2.5 py-2 text-left"
              style={{ boxShadow: `inset 4px 0 0 ${meta.color}` }}
            >
              <span style={{ color: meta.color }}>{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
              <span className="text-sm font-bold" style={{ color: meta.color }}>{meta.label}</span>
              <span className="rounded-full px-2 py-0.5 text-2xs font-bold tabular-nums" style={{ background: `color-mix(in srgb, ${meta.color} 15%, var(--color-surface))`, color: meta.color }}>{list.length}</span>
            </button>
            {open ? (
              list.length > 0 ? (
                <ul className="divide-y divide-[var(--color-line)]">
                  {list.map((v) => (
                    <VideoRow key={v.id} v={v} showEditor={showEditor} />
                  ))}
                </ul>
              ) : (
                <p className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5 text-2xs text-[var(--color-ink-faint)]">Nog geen video&apos;s in deze fase.</p>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function VideoRow({ v, showEditor = false }: { v: EditorBoardVideo; showEditor?: boolean }) {
  const days = daysSince(v.statusChangedAt);
  // Deadlinekleur: te laat = rood, ≤ 2 werkdagen = oranje, anders rustig.
  const deadlineColor =
    v.workdaysToDeadline === null
      ? "var(--color-ink-muted)"
      : v.workdaysToDeadline < 0
        ? "var(--color-bad)"
        : v.workdaysToDeadline <= 2
          ? "var(--color-warn)"
          : "var(--color-ink)";

  return (
    <li className="bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-sunken)]/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/videos/${v.id}`} className="font-medium hover:underline">{v.title}</Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <ClientLogo name={v.clientName} logoUrl={v.clientLogo} color={v.clientColor} size={16} />
              {v.clientName}
            </span>
            {showEditor ? (
              <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-2xs font-semibold text-[var(--color-ink)]">
                {v.editorName ?? "Geen editor"}
              </span>
            ) : null}
            <span>· {days} dagen in deze stap</span>
          </p>

          {/* Wat de editor nodig heeft: deadline, script en downloadlink. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="inline-flex items-center gap-1 font-medium" style={{ color: deadlineColor }}>
              <CalendarClock className="size-3.5" />
              {v.dueOn ? <>Deadline {formatDate(v.dueOn)} · {relativeDays(v.dueOn)}</> : "Geen deadline"}
            </span>

            {v.scriptHref ? (
              v.scriptHref.startsWith("/scripts/") ? (
                <Link href={v.scriptHref} className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-600)] hover:underline">
                  <FileText className="size-3.5" /> Script
                </Link>
              ) : (
                <a href={v.scriptHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-600)] hover:underline">
                  <FileText className="size-3.5" /> Script
                </a>
              )
            ) : (
              <span className="inline-flex items-center gap-1 text-[var(--color-ink-faint)]"><FileText className="size-3.5" /> Script nog niet toegevoegd</span>
            )}

            {v.downloadHref ? (
              <a href={v.downloadHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-600)] hover:underline">
                <Download className="size-3.5" /> Download beeldmateriaal
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-[var(--color-ink-faint)]"><Download className="size-3.5" /> Downloadlink nog niet toegevoegd</span>
            )}

            {v.frameUrl ? (
              <a href={v.frameUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline">
                <ExternalLink className="size-3.5" /> Frame.io
              </a>
            ) : null}

            {v.openComments > 0 ? (
              <span className="text-[var(--color-warn)]">{plural(v.openComments, "openstaande opmerking", "openstaande opmerkingen")}</span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <EditorStatusControl videoId={v.id} status={v.status} />
          <span className="text-2xs text-[var(--color-ink-faint)]">versie {v.currentVersion}</span>
        </div>
      </div>
    </li>
  );
}
