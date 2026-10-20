"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, FileText, Pencil } from "lucide-react";
import { ClientLogo, TeamAvatar } from "@/components/ui";
import { editorColor, editorDisplayName, firstNameKey } from "@/lib/editors";
import { EDIT_PHASE_META, EDIT_PHASE_ORDER, type EditPhase, type VideoStage } from "@/lib/statuses";
import { assignEditor, changeVideoStatus, setEditingVideoDeadline, setEditingVideoLinks, setEditingVideoShorts } from "@/server/actions/videos";
import type { EditorBoardVideo } from "@/server/editor-board";

type Editor = { id: string; fullName: string };

const BATTERY_COLOR: Record<EditorBoardVideo["batteryColor"], string> = {
  groen: "var(--color-good)",
  blauw: "var(--color-info)",
  oranje: "var(--color-warn)",
  rood: "var(--color-bad)",
};

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
const GRID = "minmax(140px,1.4fr) 120px minmax(150px,1.3fr) 150px minmax(120px,1fr) 64px minmax(120px,1fr) minmax(110px,1fr)";

function fmtShort(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function priority(v: EditorBoardVideo): { label: string; color: string } | null {
  if (v.phase === "afgerond" || v.workdaysToDeadline === null) return null;
  if (v.workdaysToDeadline < 0) return { label: `Te laat · ${Math.abs(v.workdaysToDeadline)} wd`, color: "var(--color-bad)" };
  if (v.workdaysToDeadline <= 2) return { label: `Dag ${v.elapsedWorkdays} · bijna deadline`, color: "var(--color-warn)" };
  return { label: `Dag ${v.elapsedWorkdays} · in productie`, color: "var(--color-info)" };
}

/**
 * Editing-opdrachten als tabel (Monday-stijl): editor-tabs bovenaan, per fase
 * gegroepeerd, met een deadline-batterij, prioriteit, aantal shorts, downloadlink
 * en script — allemaal direct in te vullen.
 */
export function EditorBoardTable({
  videos,
  editors,
  canEdit,
  canAssign,
  showTabs = true,
}: {
  videos: EditorBoardVideo[];
  editors: Editor[];
  canEdit: boolean;
  canAssign: boolean;
  showTabs?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["afgerond"]));
  const [editor, setEditor] = useState<string>("alle");

  // Editors groeperen op voornaam (dubbele accounts zoals Sam/Sem → één tab).
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; displayName: string; color: string; name: string; ids: Set<string> }>();
    for (const e of editors) {
      const key = firstNameKey(e.fullName);
      const g = map.get(key) ?? { key, displayName: editorDisplayName(e.fullName), color: editorColor(e.fullName), name: e.fullName, ids: new Set<string>() };
      g.ids.add(e.id);
      map.set(key, g);
    }
    return [...map.values()];
  }, [editors]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of videos) {
      if (v.phase === "afgerond" || !v.editorName) continue;
      const key = firstNameKey(v.editorName);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [videos]);
  const activeTotal = useMemo(() => videos.filter((v) => v.phase !== "afgerond").length, [videos]);

  const activeGroup = groups.find((g) => g.key === editor) ?? null;
  const shown = editor === "alle"
    ? videos
    : editor === "geen"
      ? videos.filter((v) => !v.editorId)
      : activeGroup
        ? videos.filter((v) => v.editorId && activeGroup.ids.has(v.editorId))
        : videos;
  const geenCount = videos.filter((v) => !v.editorId && v.phase !== "afgerond").length;

  const byPhase = useMemo(() => {
    const m = new Map<EditPhase, EditorBoardVideo[]>();
    for (const ph of EDIT_PHASE_ORDER) m.set(ph, []);
    for (const v of shown) (m.get(v.phase) ?? m.get("te_plannen")!).push(v);
    return m;
  }, [shown]);

  function toggle(ph: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(ph)) n.delete(ph);
      else n.add(ph);
      return n;
    });
  }

  return (
    <div>
      {/* Editor-tabs bovenaan: Hoofdtabel + per editor met foto en aantal. */}
      {showTabs ? (
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TextTab active={editor === "alle"} onClick={() => setEditor("alle")}>
          Hoofdtabel <span className="opacity-70">· {activeTotal}</span>
        </TextTab>
        {groups.map((g) => {
          const on = editor === g.key;
          return (
            <button key={g.key} type="button" onClick={() => setEditor(g.key)}
              className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm font-semibold transition ${on ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-card)]" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
              style={on ? { borderColor: g.color, boxShadow: `0 0 0 2px ${g.color}` } : undefined}>
              <span className="rounded-full p-[2px]" style={{ background: on ? g.color : "transparent" }}>
                <TeamAvatar name={g.name} size={36} />
              </span>
              {g.displayName}
              <span className="grid min-w-5 place-items-center rounded-full px-1 text-2xs font-bold text-white" style={{ background: g.color }}>{counts.get(g.key) ?? 0}</span>
            </button>
          );
        })}
        {geenCount > 0 ? (
          <TextTab active={editor === "geen"} onClick={() => setEditor("geen")}>
            Geen editor <span className="opacity-70">· {geenCount}</span>
          </TextTab>
        ) : null}
      </div>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <div className="min-w-[1050px]">
          <div className="grid items-center gap-px border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]" style={{ gridTemplateColumns: GRID }}>
            <span className="px-1">Item</span>
            <span className="px-1 text-center">Editor</span>
            <span className="px-1 text-center">Deadline</span>
            <span className="px-1 text-center">Fase</span>
            <span className="px-1 text-center">Prioriteit</span>
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
    </div>
  );
}

function TextTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full px-3.5 py-2 text-sm font-semibold transition ${active ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
      {children}
    </button>
  );
}

function Row({ v, editors, canEdit, canAssign, phaseColor }: { v: EditorBoardVideo; editors: Editor[]; canEdit: boolean; canAssign: boolean; phaseColor: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  const ecolor = editorColor(v.editorName ?? "");
  const prio = priority(v);
  const pct = Math.min(100, Math.max(6, Math.round((v.elapsedWorkdays / Math.max(1, v.totalWorkdays)) * 100)));

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

      {/* Deadline — batterij met datumbereik; aanklikken om de datum te wijzigen */}
      <DeadlineCell v={v} pct={pct} canEdit={canEdit} onSave={(d) => run(() => setEditingVideoDeadline(v.id, d))} />

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

      {/* Prioriteit */}
      <div className="flex items-center justify-center px-1 py-1">
        {prio ? (
          <span className="inline-flex w-full items-center justify-center rounded-[4px] px-2 py-1 text-2xs font-semibold text-white" style={{ background: prio.color }}>{prio.label}</span>
        ) : (
          <span className="text-2xs text-[var(--color-ink-faint)]">—</span>
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

/** Deadline-batterij; voor wie mag bewerken: aanklikken opent een datumveld. */
function DeadlineCell({ v, pct, canEdit, onSave }: { v: EditorBoardVideo; pct: number; canEdit: boolean; onSave: (d: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(v.dueOn ?? "");

  const bar =
    v.dueOn && v.shootDate ? (
      <div className="relative h-6 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: BATTERY_COLOR[v.batteryColor] }} />
        <span className="absolute inset-0 grid place-items-center text-2xs font-semibold text-[var(--color-ink)]">
          {fmtShort(v.shootDate)} – {fmtShort(v.dueOn)}
        </span>
      </div>
    ) : (
      <span className="w-full rounded-full border border-dashed border-[var(--color-line-strong)] py-1 text-center text-2xs text-[var(--color-ink-faint)]">+ deadline</span>
    );

  if (!canEdit) return <div className="flex items-center p-1">{bar}</div>;

  return (
    <div className="relative flex items-center p-1">
      <button type="button" className="w-full" title="Deadline wijzigen" onClick={() => { setVal(v.dueOn ?? ""); setOpen((o) => !o); }}>
        {bar}
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-1 top-full z-20 mt-1 flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-raised)]">
            <input type="date" value={val} onChange={(e) => setVal(e.target.value)} className="sc-input h-8 w-36 py-0 text-xs" />
            <button type="button" onClick={() => { onSave(val || null); setOpen(false); }} className="shrink-0 rounded bg-[var(--color-ink)] px-2 py-1.5 text-2xs font-semibold text-white">Opslaan</button>
            {v.dueOn ? (
              <button type="button" onClick={() => { onSave(null); setOpen(false); }} className="shrink-0 rounded px-2 py-1.5 text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" title="Deadline wissen">Wissen</button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ShortsField({ v, canEdit, onSave }: { v: EditorBoardVideo; canEdit: boolean; onSave: (n: number | null) => void }) {
  const fallback = v.clientDefaultShorts > 0 ? v.clientDefaultShorts : null;
  const shown = v.plannedShorts ?? fallback;
  const [val, setVal] = useState(v.plannedShorts === null ? "" : String(v.plannedShorts));
  if (!canEdit) return <span className="tabular-nums">{shown ?? "—"}</span>;
  return (
    <input type="number" min={0} value={val} placeholder={fallback !== null ? String(fallback) : "—"}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { const n = val === "" ? null : Number(val); if (n !== v.plannedShorts) onSave(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-7 w-12 rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1 text-center text-sm tabular-nums placeholder:text-[var(--color-ink-faint)]"
      aria-label="Aantal shorts"
      title={fallback !== null ? `Standaard voor deze klant: ${fallback}` : undefined} />
  );
}

/** Cel met een link: openen als er één is, en (voor wie mag) een link plakken/wijzigen. */
function LinkCell({ href, canEdit, icon, label, onSave }: { href: string | null; canEdit: boolean; icon: React.ReactNode; label: string; onSave: (u: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(href ?? "");
  const isInternal = href?.startsWith("/");

  if (open) {
    return (
      <>
        <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
        {/* Rechts uitlijnen zodat het veld naar links opent en de tabel nooit
            breder wordt (voorkomt links/rechts verspringen). */}
        <span className="absolute right-0 top-full z-20 mt-1 flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-raised)]">
          <input autoFocus value={val} placeholder="Plak een link…" onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { onSave(val || null); setOpen(false); } if (e.key === "Escape") setOpen(false); }}
            className="sc-input h-7 w-44 py-0 text-xs" />
          <button type="button" onClick={() => { onSave(val || null); setOpen(false); }} className="shrink-0 rounded bg-[var(--color-ink)] px-2 py-1 text-2xs font-semibold text-white">Ok</button>
        </span>
      </>
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
