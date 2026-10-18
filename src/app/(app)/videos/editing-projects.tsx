"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, FileText, Loader2, Plus, Upload, X } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import { EDIT_PHASE_META, EDIT_PHASE_ORDER, type EditPhase } from "@/lib/statuses";
import { createEditingProject, deleteProjectScript, setProjectEditStatus, setProjectEditor, setProjectLinks, setProjectPlannedShorts, uploadProjectScript } from "@/server/actions/editing-board";
import { fileToBase64 } from "../ai/_shared";
import type { EditingProject, BatteryColor } from "@/server/editing-board";

type Editor = { id: string; fullName: string };
type ClientOption = { id: string; name: string };

const BATTERY_COLOR: Record<BatteryColor, string> = {
  groen: "var(--color-good)",
  blauw: "var(--color-info)",
  oranje: "var(--color-warn)",
  rood: "var(--color-bad)",
};

/** Vaste kleur per editor (zoals in Monday), op voornaam. */
const EDITOR_COLOR: Record<string, string> = {
  fabian: "#0f766e",
  noah: "#5b9bf0",
  quinn: "#7c5cff",
  sem: "#22b573",
  sam: "#22b573",
  senna: "#f2843b",
};
function editorColor(name: string | null): string {
  if (!name) return "var(--color-surface-2)";
  return EDITOR_COLOR[name.trim().split(/\s+/)[0]?.toLowerCase() ?? ""] ?? "var(--color-indigo-mist)";
}

function fmtShort(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function priority(p: EditingProject): { label: string; color: string } | null {
  if (p.editStatus === "afgerond") return null;
  const day = p.elapsedWorkdays;
  if (p.workdaysToClientDeadline < 0) return { label: `Te laat · ${Math.abs(p.workdaysToClientDeadline)} wd`, color: "var(--color-bad)" };
  if (p.workdaysToClientDeadline <= 2) return { label: `Dag ${day} · bijna deadline`, color: "var(--color-warn)" };
  return { label: `Dag ${day} · in productie`, color: "var(--color-info)" };
}

// Kolombreedtes — gelijk voor de kop en alle rijen, zodat alles uitlijnt.
const GRID = "minmax(150px,1.6fr) 132px minmax(150px,1.3fr) 168px minmax(140px,1fr) 70px 108px";

export function EditingProjects({
  projects,
  editors,
  clients = [],
  canEdit,
  canAssign,
  lockedEditor = false,
}: {
  projects: EditingProject[];
  editors: Editor[];
  clients?: ClientOption[];
  canEdit: boolean;
  canAssign: boolean;
  lockedEditor?: boolean;
}) {
  const [editor, setEditor] = useState<string>("alle");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["afgerond"]));

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) if (p.editorId) m.set(p.editorId, (m.get(p.editorId) ?? 0) + 1);
    return m;
  }, [projects]);

  const shown = editor === "alle" ? projects : editor === "geen" ? projects.filter((p) => !p.editorId) : projects.filter((p) => p.editorId === editor);
  const geenCount = projects.filter((p) => !p.editorId).length;

  const byPhase = useMemo(() => {
    const m = new Map<EditPhase, EditingProject[]>();
    for (const ph of EDIT_PHASE_ORDER) m.set(ph, []);
    for (const p of shown) (m.get((p.editStatus as EditPhase)) ?? m.get("te_plannen")!).push(p);
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
      {/* Tabs: hoofdtabel + per editor (zoals in Monday). */}
      {!lockedEditor ? (
        <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-[var(--color-line)]">
          <Tab active={editor === "alle"} onClick={() => setEditor("alle")}>Hoofdtabel · {projects.length}</Tab>
          {editors.map((e) => (
            <Tab key={e.id} active={editor === e.id} onClick={() => setEditor(e.id)} color={editorColor(e.fullName)}>
              {e.fullName.split(" ")[0]} · {counts.get(e.id) ?? 0}
            </Tab>
          ))}
          {geenCount > 0 ? <Tab active={editor === "geen"} onClick={() => setEditor("geen")}>Geen editor · {geenCount}</Tab> : null}
          {canAssign && clients.length > 0 ? <span className="ml-auto pb-1"><NewProject clients={clients} editors={editors} /></span> : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <div className="min-w-[940px]">
          {/* Kolomkoppen */}
          <div className="grid items-center gap-px border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]" style={{ gridTemplateColumns: GRID }}>
            <span className="px-1">Item</span>
            <span className="px-1 text-center">Editor</span>
            <span className="px-1 text-center">Deadline</span>
            <span className="px-1 text-center">Fase</span>
            <span className="px-1 text-center">Prioriteit</span>
            <span className="px-1 text-center">Shorts</span>
            <span className="px-1 text-center">Bestanden</span>
          </div>

          {/* Alle fases altijd onder elkaar — ook de lege, zodat de hele
              pipeline zichtbaar is en je items ertussen kunt verplaatsen. */}
          {EDIT_PHASE_ORDER.map((ph) => {
            const list = byPhase.get(ph)!;
            const meta = EDIT_PHASE_META[ph];
            const open = !collapsed.has(ph);
            return (
              <div key={ph}>
                {/* Fase-groepkop in volle kleur. */}
                <button type="button" onClick={() => toggle(ph)} className="flex w-full items-center gap-2 px-2 py-2 text-left text-white" style={{ background: meta.color }}>
                  {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  <span className="text-sm font-bold">{meta.label}</span>
                  <span className="rounded-full bg-white/25 px-2 py-0.5 text-2xs font-bold tabular-nums">{list.length}</span>
                </button>
                {open ? (
                  list.length > 0 ? (
                    list.map((p) => (
                      <ProjectRow key={p.id} p={p} editors={editors} canEdit={canEdit} canAssign={canAssign} phaseColor={meta.color} />
                    ))
                  ) : (
                    <p className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5 text-2xs text-[var(--color-ink-faint)]">Nog geen projecten in deze fase.</p>
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

function Tab({ active, onClick, color, children }: { active: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-semibold ${active ? "border-[var(--color-ink)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
    >
      {color ? <span className="size-2 rounded-full" style={{ background: color }} /> : null}
      {children}
    </button>
  );
}

function ProjectRow({ p, editors, canEdit, canAssign, phaseColor }: { p: EditingProject; editors: Editor[]; canEdit: boolean; canAssign: boolean; phaseColor: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  const battery = BATTERY_COLOR[p.batteryColor];
  const pct = Math.min(100, Math.max(6, Math.round((p.elapsedWorkdays / p.totalWorkdays) * 100)));
  const prio = priority(p);
  const ecolor = editorColor(p.editorName);

  return (
    <div className="grid items-stretch gap-px border-b border-[var(--color-line)] bg-[var(--color-surface)] text-sm hover:bg-[var(--color-surface-sunken)]/40" style={{ gridTemplateColumns: GRID }}>
      {/* Item (klant) */}
      <div className="flex items-center gap-2 px-2 py-1.5" style={{ boxShadow: `inset 3px 0 0 ${battery}` }}>
        <Link href={`/clients/${p.clientSlug}?tab=opnames`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
          <ClientLogo name={p.clientName} logoUrl={p.clientLogo} color={p.clientColor} size={22} />
          <span className="truncate">{p.clientName}</span>
        </Link>
      </div>

      {/* Editor — gekleurde cel */}
      <div className="p-0.5">
        {canAssign ? (
          <select
            value={p.editorId ?? ""}
            disabled={pending}
            onChange={(e) => run(() => setProjectEditor(p.id, e.target.value || null))}
            aria-label="Editor"
            className="h-full w-full cursor-pointer rounded-[4px] border-0 px-2 text-center text-xs font-semibold text-white outline-none"
            style={{ background: p.editorId ? ecolor : "var(--color-surface-2)", color: p.editorId ? "#fff" : "var(--color-ink-muted)" }}
          >
            <option value="">Geen editor</option>
            {editors.map((ed) => <option key={ed.id} value={ed.id}>{ed.fullName.split(" ")[0]}</option>)}
          </select>
        ) : (
          <div className="grid h-full place-items-center rounded-[4px] text-xs font-semibold text-white" style={{ background: p.editorId ? ecolor : "var(--color-surface-2)" }}>
            {p.editorName?.split(" ")[0] ?? "—"}
          </div>
        )}
      </div>

      {/* Deadline — batterij met datumbereik */}
      <div className="flex items-center p-1">
        <div className="relative h-6 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: battery }} />
          <span className="absolute inset-0 grid place-items-center text-2xs font-semibold text-[var(--color-ink)]">
            {fmtShort(p.shootDate)} – {fmtShort(p.clientDeadline)}
          </span>
        </div>
      </div>

      {/* Fase — gekleurde keuzecel */}
      <div className="p-0.5">
        {canEdit ? (
          <select
            value={p.editStatus}
            disabled={pending}
            onChange={(e) => run(() => setProjectEditStatus(p.id, e.target.value))}
            aria-label="Fase"
            className="h-full w-full cursor-pointer rounded-[4px] border-0 px-2 text-center text-xs font-semibold text-white outline-none"
            style={{ background: phaseColor }}
          >
            {EDIT_PHASE_ORDER.map((s) => <option key={s} value={s}>{EDIT_PHASE_META[s].label}</option>)}
          </select>
        ) : (
          <div className="grid h-full place-items-center rounded-[4px] px-1 text-center text-xs font-semibold text-white" style={{ background: phaseColor }}>
            {EDIT_PHASE_META[(p.editStatus as EditPhase)]?.label ?? p.editStatus}
          </div>
        )}
      </div>

      {/* Prioriteit — afgeleide label */}
      <div className="flex items-center justify-center px-1 py-1">
        {prio ? (
          <span className="inline-flex w-full items-center justify-center rounded-[4px] px-2 py-1 text-2xs font-semibold text-white" style={{ background: prio.color }}>
            {prio.label}
          </span>
        ) : (
          <span className="text-2xs text-[var(--color-ink-faint)]">—</span>
        )}
      </div>

      {/* Aantal shorts */}
      <div className="flex items-center justify-center px-1">
        <ShortsField p={p} canEdit={canEdit} onSave={(n) => run(() => setProjectPlannedShorts(p.id, n))} />
      </div>

      {/* Bestanden — download + script */}
      <div className="relative flex items-center justify-center gap-1 px-1">
        <FilesCell p={p} canEdit={canEdit} run={run} pending={pending} />
      </div>
    </div>
  );
}

function ShortsField({ p, canEdit, onSave }: { p: EditingProject; canEdit: boolean; onSave: (n: number | null) => void }) {
  const [val, setVal] = useState(p.plannedShorts === null ? "" : String(p.plannedShorts));
  if (!canEdit) return <span className="tabular-nums">{p.plannedShorts ?? "—"}</span>;
  return (
    <input
      type="number"
      min={0}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { const n = val === "" ? null : Number(val); if (n !== p.plannedShorts) onSave(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-7 w-12 rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1 text-center text-sm tabular-nums"
      aria-label="Aantal shorts"
      title={`${p.shortsCount} klaar`}
    />
  );
}

function FilesCell({ p, canEdit, run, pending }: { p: EditingProject; canEdit: boolean; run: (fn: () => Promise<unknown>) => void; pending: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) return;
    if (file.size > 10 * 1024 * 1024) return;
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      run(() => uploadProjectScript(p.id, { fileName: file.name, contentType: file.type || "application/pdf", base64 }));
    } finally {
      setBusy(false);
    }
  }

  const footage = p.footageUrl;
  const scriptHref = p.scriptFileId ? `/api/edit-files/${p.scriptFileId}` : p.scriptUrl;

  return (
    <>
      {/* Download (beeldmateriaal) */}
      {footage ? (
        <a href={footage} target="_blank" rel="noopener noreferrer" title="Download beeldmateriaal" className="grid size-7 place-items-center rounded text-[var(--color-brand-600)] hover:bg-[var(--color-surface-2)]">
          <Download className="size-4" />
        </a>
      ) : canEdit ? (
        <LinkEditor current={null} icon={<Download className="size-4" />} title="Download-link toevoegen" onSave={(u) => run(() => setProjectLinks(p.id, { footageUrl: u }))} />
      ) : (
        <span className="grid size-7 place-items-center text-[var(--color-ink-faint)]" title="Geen download-link"><Download className="size-4 opacity-40" /></span>
      )}

      {/* Script (pdf) */}
      {scriptHref ? (
        <a href={scriptHref} target="_blank" rel="noopener noreferrer" title={p.scriptFileName ?? "Script openen"} className="grid size-7 place-items-center rounded text-[var(--color-brand-600)] hover:bg-[var(--color-surface-2)]">
          <FileText className="size-4" />
        </a>
      ) : canEdit ? (
        <>
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || pending} title="Script-pdf uploaden" className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          </button>
        </>
      ) : (
        <span className="grid size-7 place-items-center text-[var(--color-ink-faint)]" title="Geen script"><FileText className="size-4 opacity-40" /></span>
      )}

      {/* Script verwijderen (alleen als een pdf is geüpload) */}
      {canEdit && p.scriptFileId ? (
        <button type="button" onClick={() => run(() => deleteProjectScript(p.id))} title="Script verwijderen" className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]">
          <X className="size-3.5" />
        </button>
      ) : null}
    </>
  );
}

function LinkEditor({ current, icon, title, onSave }: { current: string | null; icon: React.ReactNode; title: string; onSave: (u: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current ?? "");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title={title} className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
        {icon}
      </button>
    );
  }
  return (
    <span className="absolute z-20 mt-8 flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-raised)]">
      <input autoFocus value={val} placeholder="Plak een link…" onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { onSave(val || null); setOpen(false); } if (e.key === "Escape") setOpen(false); }}
        className="sc-input h-7 w-44 py-0 text-xs" />
      <button type="button" onClick={() => { onSave(val || null); setOpen(false); }} className="shrink-0 rounded bg-[var(--color-ink)] px-2 py-1 text-2xs font-semibold text-white">Ok</button>
    </span>
  );
}

function NewProject({ clients, editors }: { clients: ClientOption[]; editors: Editor[] }) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [title, setTitle] = useState("");
  const [editorId, setEditorId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function create() {
    setErr(null);
    start(async () => {
      const res = await createEditingProject({ clientId, scheduledOn, title, editorId: editorId || null });
      if (res.ok) { setOpen(false); setClientId(""); setScheduledOn(""); setTitle(""); setEditorId(""); router.refresh(); }
      else setErr(res.message ?? "Mislukt");
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-indigo-soft)]">
        <Plus className="size-3.5" /> Nieuw item
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5">
      <label className="text-2xs text-[var(--color-ink-muted)]">Klant
        <select className="sc-input mt-0.5 h-8 w-40 py-0 text-xs" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Kies…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="text-2xs text-[var(--color-ink-muted)]">Opnamedatum
        <input type="date" className="sc-input mt-0.5 h-8 w-36 py-0 text-xs" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
      </label>
      <label className="text-2xs text-[var(--color-ink-muted)]">Titel
        <input className="sc-input mt-0.5 h-8 w-44 py-0 text-xs" placeholder="bv. Opname + onderwerp" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="text-2xs text-[var(--color-ink-muted)]">Editor
        <select className="sc-input mt-0.5 h-8 w-32 py-0 text-xs" value={editorId} onChange={(e) => setEditorId(e.target.value)}>
          <option value="">Later</option>
          {editors.map((e) => <option key={e.id} value={e.id}>{e.fullName.split(" ")[0]}</option>)}
        </select>
      </label>
      <button type="button" onClick={create} disabled={pending || !clientId || !scheduledOn || !title.trim()} className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-3 text-xs font-semibold text-white disabled:opacity-50">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Aanmaken
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-[var(--radius-sm)] px-2 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Annuleren</button>
      {err ? <span className="w-full text-2xs text-[var(--color-bad)]">{err}</span> : null}
    </div>
  );
}
