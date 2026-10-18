"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Battery, ChevronDown, Download, FileText, Loader2, Pencil, Plus, Upload, X } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import { EDIT_PHASE_META, EDIT_PHASE_ORDER, type EditPhase } from "@/lib/statuses";
import { formatDate } from "@/lib/format";
import { createEditingProject, deleteProjectScript, setProjectEditStatus, setProjectEditor, setProjectLinks, setProjectPlannedShorts, uploadProjectScript } from "@/server/actions/editing-board";
import { fileToBase64 } from "../ai/_shared";
import type { EditingProject, BatteryColor } from "@/server/editing-board";

const BATTERY_COLOR: Record<BatteryColor, string> = {
  groen: "var(--color-good)",
  blauw: "var(--color-brand-600)",
  oranje: "var(--color-warn)",
  rood: "var(--color-bad)",
};

type Editor = { id: string; fullName: string };
type ClientOption = { id: string; name: string };

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
  /** true voor editors zelf: geen switcher, ze zien alleen hun eigen board. */
  lockedEditor?: boolean;
}) {
  const [editor, setEditor] = useState<string>("alle");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) if (p.editorId) m.set(p.editorId, (m.get(p.editorId) ?? 0) + 1);
    return m;
  }, [projects]);

  const shown = editor === "alle" ? projects : editor === "geen" ? projects.filter((p) => !p.editorId) : projects.filter((p) => p.editorId === editor);
  const geenCount = projects.filter((p) => !p.editorId).length;

  return (
    <div>
      {!lockedEditor ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Editor:</span>
          <SwitchBtn active={editor === "alle"} onClick={() => setEditor("alle")}>Alle · {projects.length}</SwitchBtn>
          {editors.map((e) => (
            <SwitchBtn key={e.id} active={editor === e.id} onClick={() => setEditor(e.id)}>
              {e.fullName.split(" ")[0]} · {counts.get(e.id) ?? 0}
            </SwitchBtn>
          ))}
          {geenCount > 0 ? <SwitchBtn active={editor === "geen"} onClick={() => setEditor("geen")}>Geen editor · {geenCount}</SwitchBtn> : null}
          {canAssign && clients.length > 0 ? <span className="ml-auto"><NewProject clients={clients} editors={editors} /></span> : null}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)]/50 px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
          Geen editing-projecten in deze weergave.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} editors={editors} canEdit={canEdit} canAssign={canAssign} />
          ))}
        </div>
      )}
    </div>
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
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-indigo-ink)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--color-indigo-soft)]">
        <Plus className="size-3.5" /> Nieuw project
      </button>
    );
  }
  return (
    <div className="mt-2 flex w-full flex-wrap items-end gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5">
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
        <input className="sc-input mt-0.5 h-8 w-48 py-0 text-xs" placeholder="bv. Opname + onderwerp" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="text-2xs text-[var(--color-ink-muted)]">Editor
        <select className="sc-input mt-0.5 h-8 w-32 py-0 text-xs" value={editorId} onChange={(e) => setEditorId(e.target.value)}>
          <option value="">Later</option>
          {editors.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
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

function SwitchBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-[var(--color-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
    >
      {children}
    </button>
  );
}

function ProjectCard({ p, editors, canEdit, canAssign }: { p: EditingProject; editors: Editor[]; canEdit: boolean; canAssign: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  const meta = EDIT_PHASE_META[(p.editStatus as EditPhase)] ?? EDIT_PHASE_META.te_plannen;
  const battery = BATTERY_COLOR[p.batteryColor];
  const pct = Math.round((p.elapsedWorkdays / p.totalWorkdays) * 100);
  const deadlineText =
    p.editStatus === "afgerond"
      ? "Afgerond"
      : p.workdaysToClientDeadline < 0
        ? `${Math.abs(p.workdaysToClientDeadline)} werkdag(en) te laat`
        : `nog ${p.workdaysToClientDeadline} werkdag(en)`;

  return (
    <div className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4" style={{ boxShadow: `inset 3px 0 0 ${battery}` }}>
      {/* Kop: klant + opnamedatum + fase */}
      <div className="flex items-start justify-between gap-2">
        <Link href={`/clients/${p.clientSlug}?tab=opnames`} className="flex min-w-0 items-center gap-2 hover:underline">
          <ClientLogo name={p.clientName} logoUrl={p.clientLogo} color={p.clientColor} size={28} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{p.clientName}</span>
            <span className="block text-2xs text-[var(--color-ink-muted)]">opname {formatDate(p.shootDate)}</span>
          </span>
        </Link>
        <PhasePicker status={p.editStatus} canEdit={canEdit} pending={pending} onPick={(s) => run(() => setProjectEditStatus(p.id, s))} />
      </div>

      {/* Batterij: 14 werkdagen opname → oplevering */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-2xs">
          <span className="inline-flex items-center gap-1 font-medium" style={{ color: battery }}>
            <Battery className="size-3.5" /> {deadlineText}
          </span>
          <span className="text-[var(--color-ink-faint)]">oplevering {formatDate(p.clientDeadline)}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
          <span className="block h-full rounded-full transition-[width]" style={{ width: `${Math.min(100, Math.max(6, pct))}%`, background: battery }} />
        </div>
      </div>

      {/* Wacht op · shorts · editor */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)]">
          wacht op <strong className="text-[var(--color-ink)]">{meta.waitOn}</strong>
        </span>
        <ShortsField p={p} canEdit={canEdit} onSave={(n) => run(() => setProjectPlannedShorts(p.id, n))} />
        <span className="ml-auto">
          {canAssign ? (
            <select
              className="sc-input h-7 w-auto py-0 text-xs"
              value={p.editorId ?? ""}
              disabled={pending}
              onChange={(e) => run(() => setProjectEditor(p.id, e.target.value || null))}
              aria-label="Editor toewijzen"
            >
              <option value="">Geen editor</option>
              {editors.map((ed) => <option key={ed.id} value={ed.id}>{ed.fullName}</option>)}
            </select>
          ) : (
            <span className="text-[var(--color-ink-muted)]">{p.editorName ?? "Geen editor"}</span>
          )}
        </span>
      </div>

      {/* Download- en scriptlink */}
      <div className="mt-3 border-t border-[var(--color-line)] pt-2.5">
        <LinkRow
          icon={<Download className="size-3.5" />}
          label="Download (beeldmateriaal)"
          url={p.footageUrl}
          canEdit={canEdit}
          onSave={(u) => run(() => setProjectLinks(p.id, { footageUrl: u }))}
        />
        <ScriptField p={p} canEdit={canEdit} pending={pending} run={run} />
      </div>
    </div>
  );
}

function PhasePicker({ status, canEdit, pending, onPick }: { status: string; canEdit: boolean; pending: boolean; onPick: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const meta = EDIT_PHASE_META[(status as EditPhase)] ?? EDIT_PHASE_META.te_plannen;
  if (!canEdit) {
    return <span className="inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: meta.color }}>{meta.label}</span>;
  }
  return (
    <div className="shrink-0 text-right">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={pending}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
        style={{ background: meta.color, boxShadow: open ? "0 0 0 2px var(--color-ink)" : undefined }}>
        {meta.label}
        {pending ? <Loader2 className="size-3 animate-spin" /> : <ChevronDown className="size-3 opacity-80" />}
      </button>
      {open ? (
        <div className="mt-1.5 flex max-w-[220px] flex-wrap justify-end gap-1">
          {EDIT_PHASE_ORDER.map((s) => (
            <button key={s} type="button" onClick={() => { setOpen(false); onPick(s); }}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold text-white ${s === status ? "ring-2 ring-[var(--color-ink)]" : "opacity-80 hover:opacity-100"}`}
              style={{ background: EDIT_PHASE_META[s].color }}>
              {EDIT_PHASE_META[s].label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ShortsField({ p, canEdit, onSave }: { p: EditingProject; canEdit: boolean; onSave: (n: number | null) => void }) {
  const [val, setVal] = useState(p.plannedShorts === null ? "" : String(p.plannedShorts));
  const label = <span className="text-[var(--color-ink-faint)]">({p.shortsCount} klaar)</span>;
  if (!canEdit) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)]">{p.plannedShorts ?? "—"} shorts {label}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)]">
      <input
        type="number"
        value={val}
        min={0}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => { const n = val === "" ? null : Number(val); if (n !== p.plannedShorts) onSave(n); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-5 w-10 rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1 text-right tabular-nums"
        aria-label="Aantal shorts"
      />
      shorts {label}
    </span>
  );
}

function ScriptField({ p, canEdit, pending, run }: { p: EditingProject; canEdit: boolean; pending: boolean; run: (fn: () => Promise<unknown>) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState(p.scriptUrl ?? "");

  async function onFile(file: File) {
    setErr(null);
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) { setErr("Alleen een pdf-bestand."); return; }
    if (file.size > 10 * 1024 * 1024) { setErr("Max 10 MB."); return; }
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      run(() => uploadProjectScript(p.id, { fileName: file.name, contentType: file.type || "application/pdf", base64 }));
    } catch {
      setErr("Uploaden mislukt.");
    } finally {
      setBusy(false);
    }
  }

  // Geüpload script aanwezig → openen/downloaden (+ verwijderen).
  if (p.scriptFileId) {
    return (
      <div className="flex items-center gap-1.5 py-1 text-xs">
        <FileText className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
        <a href={`/api/edit-files/${p.scriptFileId}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium text-[var(--color-brand-600)] hover:underline">
          {p.scriptFileName ?? "Script.pdf"} — openen
        </a>
        {canEdit ? (
          <button type="button" onClick={() => run(() => deleteProjectScript(p.id))} className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]" aria-label="Script verwijderen">
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="py-1 text-xs">
      <div className="flex items-center gap-1.5">
        <FileText className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
        {canEdit ? (
          <>
            <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || pending}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Script-pdf uploaden
            </button>
            {p.scriptUrl ? (
              <a href={p.scriptUrl} target="_blank" rel="noopener noreferrer" className="truncate text-[var(--color-brand-600)] hover:underline">of open de link</a>
            ) : (
              <button type="button" onClick={() => { setLink(p.scriptUrl ?? ""); setLinking(true); }} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">of plak een link</button>
            )}
          </>
        ) : p.scriptUrl ? (
          <a href={p.scriptUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium text-[var(--color-brand-600)] hover:underline">Script openen</a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[var(--color-ink-faint)]">Script: nog geen</span>
        )}
      </div>
      {linking ? (
        <div className="mt-1 flex items-center gap-1.5">
          <input autoFocus value={link} placeholder="Plak een link naar het script…" onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { run(() => setProjectLinks(p.id, { scriptUrl: link })); setLinking(false); } if (e.key === "Escape") setLinking(false); }}
            className="sc-input h-7 flex-1 py-0 text-xs" />
          <button type="button" onClick={() => { run(() => setProjectLinks(p.id, { scriptUrl: link })); setLinking(false); }} className="shrink-0 rounded bg-[var(--color-ink)] px-2 py-1 text-2xs font-semibold text-white">Opslaan</button>
        </div>
      ) : null}
      {err ? <span className="mt-1 block text-[var(--color-bad)]">{err}</span> : null}
    </div>
  );
}

function LinkRow({ icon, label, url, canEdit, onSave }: { icon: React.ReactNode; label: string; url: string | null; canEdit: boolean; onSave: (u: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(url ?? "");

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 py-1">
        <span className="shrink-0 text-[var(--color-ink-faint)]">{icon}</span>
        <input
          autoFocus
          value={val}
          placeholder="Plak een link (bijv. Drive/Dropbox)…"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { onSave(val); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
          className="sc-input h-7 flex-1 py-0 text-xs"
        />
        <button type="button" onClick={() => { onSave(val); setEditing(false); }} className="shrink-0 rounded bg-[var(--color-ink)] px-2 py-1 text-2xs font-semibold text-white">Opslaan</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 py-1 text-xs">
      <span className="shrink-0 text-[var(--color-ink-faint)]">{icon}</span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium text-[var(--color-brand-600)] hover:underline">{label} openen</a>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[var(--color-ink-faint)]">{label}: nog geen link</span>
      )}
      {canEdit ? (
        <button type="button" onClick={() => { setVal(url ?? ""); setEditing(true); }} className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]" aria-label={`${label} bewerken`}>
          <Pencil className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
