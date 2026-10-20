"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, FileText, Loader2, Pencil } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import { formatDate, relativeDays } from "@/lib/format";
import { editorColor, editorDisplayName } from "@/lib/editors";
import { EDIT_PHASE_META, EDIT_PHASE_ORDER, type EditPhase, type VideoStage } from "@/lib/statuses";
import { assignEditor, changeVideoStatus, setEditingVideoLinks, setEditingVideoShorts } from "@/server/actions/videos";
import type { EditorBoardVideo } from "@/server/editor-board";

type Editor = { id: string; fullName: string };

/** Fase (kolom) → de status die we zetten als je 'm kiest. */
const PHASE_TO_STATUS: Record<EditPhase, VideoStage> = {
  te_plannen: "recorded",
  in_edit: "editing",
  interne_controle: "internal_review",
  bij_klant: "client_review",
  feedback_verwerken: "client_revision",
  afgerond: "approved",
};

// Kolombreedtes — gelijk voor kop en rijen zodat alles uitlijnt.
const GRID = "minmax(150px,1.5fr) 128px 150px 150px 70px minmax(130px,1fr) minmax(120px,1fr)";

/**
 * Editing-opdrachten als tabel (Monday-stijl), per fase gegroepeerd. Per rij:
 * klant, editor, deadline, fase, aantal shorts, downloadlink en script — met de
 * links en het script direct in te vullen.
 */
export function EditorBoardTable({
  videos,
  editors,
  canEdit,
  canAssign,
}: {
  videos: EditorBoardVideo[];
  editors: Editor[];
  canEdit: boolean;
  canAssign: boolean;
}) {
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
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
      <div className="min-w-[1000px]">
        {/* Kolomkoppen */}
        <div className="grid items-center gap-px border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]" style={{ gridTemplateColumns: GRID }}>
          <span className="px-1">Item</span>
          <span className="px-1 text-center">Editor</span>
          <span className="px-1 text-center">Deadline</span>
          <span className="px-1 text-center">Fase</span>
          <span className="px-1 text-center">Shorts</span>
          <span className="px-1 text-center">Links shorts</span>
          <span className="px-1 text-center">Script</span>
        </div>

        {EDIT_PHASE_ORDER.map((ph) => {
          const list = byPhase.get(ph)!;
          const meta = EDIT_PHASE_META[ph];
          const open = !collapsed.has(ph);
          return (
            <div key={ph}>
              <button type="button" onClick={() => toggle(ph)}
                className="flex w-full items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2.5 py-2 text-left"
                style={{ boxShadow: `inset 4px 0 0 ${meta.color}` }}>
                <span style={{ color: meta.color }}>{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
                <span className="text-sm font-bold" style={{ color: meta.color }}>{meta.label}</span>
                <span className="rounded-full px-2 py-0.5 text-2xs font-bold tabular-nums" style={{ background: `color-mix(in srgb, ${meta.color} 15%, var(--color-surface))`, color: meta.color }}>{list.length}</span>
              </button>
              {open ? (
                list.length > 0 ? (
                  list.map((v) => <Row key={v.id} v={v} editors={editors} canEdit={canEdit} canAssign={canAssign} phaseColor={meta.color} />)
                ) : (
                  <p className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5 text-2xs text-[var(--color-ink-faint)]">Nog geen video&apos;s in deze fase.</p>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ v, editors, canEdit, canAssign, phaseColor }: { v: EditorBoardVideo; editors: Editor[]; canEdit: boolean; canAssign: boolean; phaseColor: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  const ecolor = editorColor(v.editorName ?? "");
  const deadlineColor = v.workdaysToDeadline === null ? "var(--color-ink-muted)" : v.workdaysToDeadline < 0 ? "var(--color-bad)" : v.workdaysToDeadline <= 2 ? "var(--color-warn)" : "var(--color-ink)";

  return (
    <div className="grid items-stretch gap-px border-b border-[var(--color-line)] bg-[var(--color-surface)] text-sm hover:bg-[var(--color-surface-sunken)]/40" style={{ gridTemplateColumns: GRID }}>
      {/* Item (klant) */}
      <div className="flex items-center gap-2.5 px-2.5 py-2" style={{ boxShadow: `inset 4px 0 0 ${phaseColor}` }}>
        <Link href={`/videos/${v.id}`} className="flex min-w-0 items-center gap-2.5 font-medium hover:underline">
          <ClientLogo name={v.clientName} logoUrl={v.clientLogo} color={v.clientColor} size={28} />
          <span className="truncate">{v.clientName}</span>
        </Link>
      </div>

      {/* Editor */}
      <div className="p-0.5">
        {canAssign ? (
          <select value={v.editorId ?? ""} disabled={pending}
            onChange={(e) => run(() => assignEditor(v.id, e.target.value || null))}
            aria-label="Editor"
            className="h-full w-full cursor-pointer rounded-[4px] border-0 px-2 text-center text-sm font-bold outline-none"
            style={{ background: v.editorId ? ecolor : "var(--color-surface-2)", color: v.editorId ? "#fff" : "var(--color-ink-muted)" }}>
            <option value="">Geen editor</option>
            {editors.map((ed) => <option key={ed.id} value={ed.id}>{editorDisplayName(ed.fullName)}</option>)}
          </select>
        ) : (
          <div className="grid h-full place-items-center rounded-[4px] text-sm font-bold text-white" style={{ background: v.editorId ? ecolor : "var(--color-surface-2)" }}>
            {v.editorName?.split(" ")[0] ?? "—"}
          </div>
        )}
      </div>

      {/* Deadline */}
      <div className="flex items-center justify-center px-1 text-center text-xs font-medium" style={{ color: deadlineColor }}>
        {v.dueOn ? <span>{formatDate(v.dueOn)}<br /><span className="font-normal text-2xs">{relativeDays(v.dueOn)}</span></span> : <span className="text-[var(--color-ink-faint)]">—</span>}
      </div>

      {/* Fase */}
      <div className="p-0.5">
        {canEdit ? (
          <select value={v.phase} disabled={pending}
            onChange={(e) => run(() => changeVideoStatus(v.id, PHASE_TO_STATUS[e.target.value as EditPhase]))}
            aria-label="Fase"
            className="h-full w-full cursor-pointer rounded-[4px] border-0 px-2 text-center text-xs font-semibold outline-none"
            style={{ background: `color-mix(in srgb, ${phaseColor} 13%, var(--color-surface))`, color: phaseColor }}>
            {EDIT_PHASE_ORDER.map((p) => <option key={p} value={p}>{EDIT_PHASE_META[p].label}</option>)}
          </select>
        ) : (
          <div className="grid h-full place-items-center rounded-[4px] px-1 text-center text-xs font-semibold" style={{ background: `color-mix(in srgb, ${phaseColor} 13%, var(--color-surface))`, color: phaseColor }}>
            {EDIT_PHASE_META[v.phase].label}
          </div>
        )}
      </div>

      {/* Aantal shorts */}
      <div className="flex items-center justify-center px-1">
        <ShortsField v={v} canEdit={canEdit} onSave={(n) => run(() => setEditingVideoShorts(v.id, n))} />
      </div>

      {/* Links shorts (downloadlink) */}
      <div className="relative flex items-center justify-center px-1">
        <LinkCell href={v.downloadHref} canEdit={canEdit} icon={<Download className="size-3.5" />} label="Download"
          onSave={(u) => run(() => setEditingVideoLinks(v.id, { footageUrl: u }))} />
      </div>

      {/* Script */}
      <div className="relative flex items-center justify-center px-1">
        <LinkCell href={v.scriptHref} canEdit={canEdit} icon={<FileText className="size-3.5" />} label="Script"
          onSave={(u) => run(() => setEditingVideoLinks(v.id, { scriptUrl: u }))} />
      </div>
    </div>
  );
}

function ShortsField({ v, canEdit, onSave }: { v: EditorBoardVideo; canEdit: boolean; onSave: (n: number | null) => void }) {
  const [val, setVal] = useState(v.plannedShorts === null ? "" : String(v.plannedShorts));
  if (!canEdit) return <span className="tabular-nums">{v.plannedShorts ?? "—"}</span>;
  return (
    <input type="number" min={0} value={val} placeholder="—"
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { const n = val === "" ? null : Number(val); if (n !== v.plannedShorts) onSave(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-7 w-12 rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1 text-center text-sm tabular-nums placeholder:text-[var(--color-ink-faint)]"
      aria-label="Aantal shorts" />
  );
}

/** Cel met een link: openen als er één is, en (voor wie mag) een link plakken/wijzigen. */
function LinkCell({ href, canEdit, icon, label, onSave }: { href: string | null; canEdit: boolean; icon: React.ReactNode; label: string; onSave: (u: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(href ?? "");
  const isInternal = href?.startsWith("/");

  if (open) {
    return (
      <span className="absolute z-20 mt-8 flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-raised)]">
        <input autoFocus value={val} placeholder="Plak een link…" onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { onSave(val || null); setOpen(false); } if (e.key === "Escape") setOpen(false); }}
          className="sc-input h-7 w-44 py-0 text-xs" />
        <button type="button" onClick={() => { onSave(val || null); setOpen(false); }} className="shrink-0 rounded bg-[var(--color-ink)] px-2 py-1 text-2xs font-semibold text-white">Ok</button>
      </span>
    );
  }
  if (href) {
    return (
      <span className="flex items-center gap-1">
        {isInternal ? (
          <Link href={href} className="inline-flex items-center gap-1 rounded-[4px] bg-[var(--color-brand-50)] px-2 py-1 text-2xs font-semibold text-[var(--color-brand-700)] hover:brightness-95">{icon} {label}</Link>
        ) : (
          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-[4px] bg-[var(--color-brand-50)] px-2 py-1 text-2xs font-semibold text-[var(--color-brand-700)] hover:brightness-95">{icon} {label}</a>
        )}
        {canEdit ? (
          <button type="button" onClick={() => { setVal(href.startsWith("/") ? "" : href); setOpen(true); }} title="Link wijzigen" className="grid size-6 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"><Pencil className="size-3.5" /></button>
        ) : null}
      </span>
    );
  }
  if (!canEdit) return <span className="text-2xs text-[var(--color-ink-faint)]">—</span>;
  return (
    <button type="button" onClick={() => { setVal(""); setOpen(true); }}
      className="inline-flex items-center gap-1 rounded-[4px] border border-dashed border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
      {icon} + link
    </button>
  );
}
