"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, FileText, Loader2, Pencil, Plus, Upload, X } from "lucide-react";
import { ClientLogo, TeamAvatar } from "@/components/ui";
import { editorColor, editorDisplayName, firstNameKey } from "@/lib/editors";
import { EDIT_PHASE_META, EDIT_PHASE_ORDER, type EditPhase } from "@/lib/statuses";
import { createEditingProject, deleteProjectScript, setProjectDeadline, setProjectEditStatus, setProjectEditor, setProjectLinks, setProjectPlannedShorts, uploadProjectScript } from "@/server/actions/editing-board";
import { fileToBase64 } from "../ai/_shared";
import type { EditingProject, BatteryColor } from "@/server/editing-board";

type Editor = { id: string; fullName: string; avatarUrl?: string | null };
type ClientOption = { id: string; name: string };

const BATTERY_COLOR: Record<BatteryColor, string> = {
  groen: "var(--color-good)",
  blauw: "var(--color-info)",
  oranje: "var(--color-warn)",
  rood: "var(--color-bad)",
};

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
const GRID = "minmax(150px,1.6fr) 132px minmax(150px,1.3fr) 168px minmax(130px,1fr) 64px 118px 118px";

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

  // Editors groeperen op canonieke voornaam, zodat dubbele accounts (bijv. een
  // "Sem" én een verkeerd gespelde "Sam") één tab worden.
  const groups = useMemo(() => {
    const idToKey = new Map<string, string>();
    for (const e of editors) idToKey.set(e.id, firstNameKey(e.fullName));
    const map = new Map<string, { key: string; displayName: string; color: string; avatarUrl: string | null; name: string; ids: Set<string> }>();
    for (const e of editors) {
      const key = firstNameKey(e.fullName);
      const g = map.get(key) ?? { key, displayName: editorDisplayName(e.fullName), color: editorColor(e.fullName), avatarUrl: e.avatarUrl ?? null, name: e.fullName, ids: new Set<string>() };
      g.ids.add(e.id);
      if (!g.avatarUrl && e.avatarUrl) g.avatarUrl = e.avatarUrl;
      map.set(key, g);
    }
    return { list: [...map.values()], idToKey };
  }, [editors]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) {
      if (!p.editorId) continue;
      const key = groups.idToKey.get(p.editorId);
      if (key) m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [projects, groups]);

  const activeGroup = groups.list.find((g) => g.key === editor) ?? null;
  const shown = editor === "alle"
    ? projects
    : editor === "geen"
      ? projects.filter((p) => !p.editorId)
      : activeGroup
        ? projects.filter((p) => p.editorId && activeGroup.ids.has(p.editorId))
        : projects;
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
      {/* Editor-tabs: groot en opvallend, met de foto's van de editors. */}
      {!lockedEditor ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <TextTab active={editor === "alle"} onClick={() => setEditor("alle")}>
            Hoofdtabel <span className="opacity-70">· {projects.length}</span>
          </TextTab>
          {groups.list.map((g) => {
            const on = editor === g.key;
            const c = g.color;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => setEditor(g.key)}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm font-semibold transition ${on ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-card)]" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
                style={on ? { borderColor: c, boxShadow: `0 0 0 2px ${c}` } : undefined}
              >
                <span className="rounded-full p-[2px]" style={{ background: on ? c : "transparent" }}>
                  <TeamAvatar name={g.name} avatarUrl={g.avatarUrl} size={44} />
                </span>
                {g.displayName}
                <span className="grid min-w-5 place-items-center rounded-full px-1 text-2xs font-bold text-white" style={{ background: c }}>{counts.get(g.key) ?? 0}</span>
              </button>
            );
          })}
          {geenCount > 0 ? (
            <TextTab active={editor === "geen"} onClick={() => setEditor("geen")}>
              Geen editor <span className="opacity-70">· {geenCount}</span>
            </TextTab>
          ) : null}
          {canAssign && clients.length > 0 ? <span className="ml-auto"><NewProject clients={clients} editors={editors} /></span> : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <div className="min-w-[1000px]">
          {/* Kolomkoppen */}
          <div className="grid items-center gap-px border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]" style={{ gridTemplateColumns: GRID }}>
            <span className="px-1">Item</span>
            <span className="px-1 text-center">Editor</span>
            <span className="px-1 text-center">Deadline</span>
            <span className="px-1 text-center">Fase</span>
            <span className="px-1 text-center">Prioriteit</span>
            <span className="px-1 text-center">Shorts</span>
            <span className="px-1 text-center">Script</span>
            <span className="px-1 text-center">Download</span>
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

function TextTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-2 text-sm font-semibold transition ${active ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
    >
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
      <div className="flex items-center gap-2.5 px-2.5 py-2" style={{ boxShadow: `inset 3px 0 0 ${battery}` }}>
        <Link href={`/clients/${p.clientSlug}?tab=opnames`} className="flex min-w-0 items-center gap-2.5 font-medium hover:underline">
          <ClientLogo name={p.clientName} logoUrl={p.clientLogo} color={p.clientColor} size={32} />
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
            className="h-full w-full cursor-pointer rounded-[4px] border-0 px-2 text-center text-sm font-bold text-white outline-none"
            style={{ background: p.editorId ? ecolor : "var(--color-surface-2)", color: p.editorId ? "#fff" : "var(--color-ink-muted)" }}
          >
            <option value="">Geen editor</option>
            {editors.map((ed) => <option key={ed.id} value={ed.id}>{editorDisplayName(ed.fullName)}</option>)}
          </select>
        ) : (
          <div className="grid h-full place-items-center rounded-[4px] text-sm font-bold text-white" style={{ background: p.editorId ? ecolor : "var(--color-surface-2)" }}>
            {p.editorName?.split(" ")[0] ?? "—"}
          </div>
        )}
      </div>

      {/* Deadline — batterij met datumbereik, aanpasbaar */}
      <DeadlineCell p={p} pct={pct} battery={battery} canEdit={canEdit} onSave={(d) => run(() => setProjectDeadline(p.id, d))} />


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

      {/* Script — link of geüploade pdf */}
      <div className="relative flex items-center justify-center px-1">
        <ScriptCell p={p} canEdit={canEdit} run={run} pending={pending} />
      </div>

      {/* Download — link naar het beeldmateriaal */}
      <div className="relative flex items-center justify-center px-1">
        <DownloadCell p={p} canEdit={canEdit} run={run} />
      </div>
    </div>
  );
}

/** Script is altijd een bestand: openen als er een pdf is, anders slepen/uploaden. */
function ScriptCell({ p, canEdit, run, pending }: { p: EditingProject; canEdit: boolean; run: (fn: () => Promise<unknown>) => void; pending: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  // Alleen geüploade scriptbestanden; een eventuele oude scriptlink tonen we
  // nog wel als er geen bestand is, maar nieuw toevoegen kan alleen als bestand.
  const scriptHref = p.scriptFileId ? `/api/edit-files/${p.scriptFileId}` : p.scriptUrl;

  async function onFile(file: File | undefined) {
    if (!file) return;
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

  if (scriptHref) {
    return (
      <span className="flex items-center gap-1">
        <a href={scriptHref} target="_blank" rel="noopener noreferrer" title={p.scriptFileName ?? "Script openen"}
          className="inline-flex items-center gap-1 rounded-[4px] bg-[var(--color-brand-50)] px-2 py-1 text-2xs font-semibold text-[var(--color-brand-700)] hover:brightness-95">
          <FileText className="size-3.5" /> Script
        </a>
        {canEdit && p.scriptFileId ? (
          <button type="button" onClick={() => run(() => deleteProjectScript(p.id))} title="Scriptbestand verwijderen" className="grid size-6 place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]">
            <X className="size-3.5" />
          </button>
        ) : null}
      </span>
    );
  }
  if (!canEdit) return <span className="text-2xs text-[var(--color-ink-faint)]">—</span>;
  return (
    <>
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0]); }}
        disabled={busy || pending}
        title="Scriptbestand (pdf) slepen of kiezen"
        className={`inline-flex items-center gap-1 rounded-[4px] border border-dashed px-2 py-1 text-2xs font-medium transition ${over ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        Sleep/upload
      </button>
    </>
  );
}

/** Download-link naar het beeldmateriaal — openen of een link plakken. */
function DownloadCell({ p, canEdit, run }: { p: EditingProject; canEdit: boolean; run: (fn: () => Promise<unknown>) => void }) {
  if (p.footageUrl) {
    return (
      <span className="flex items-center gap-1">
        <a href={p.footageUrl} target="_blank" rel="noopener noreferrer" title="Download beeldmateriaal"
          className="inline-flex items-center gap-1 rounded-[4px] bg-[var(--color-brand-50)] px-2 py-1 text-2xs font-semibold text-[var(--color-brand-700)] hover:brightness-95">
          <Download className="size-3.5" /> Download
        </a>
        {canEdit ? (
          <LinkEditor current={p.footageUrl} label="" icon={<Pencil className="size-3.5" />} title="Download-link wijzigen" onSave={(u) => run(() => setProjectLinks(p.id, { footageUrl: u }))} />
        ) : null}
      </span>
    );
  }
  if (!canEdit) return <span className="text-2xs text-[var(--color-ink-faint)]">—</span>;
  return <LinkEditor current={null} label="+ link" icon={<Download className="size-3.5" />} title="Download-link toevoegen" onSave={(u) => run(() => setProjectLinks(p.id, { footageUrl: u }))} />;
}

function DeadlineCell({ p, pct, battery, canEdit, onSave }: { p: EditingProject; pct: number; battery: string; canEdit: boolean; onSave: (d: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(p.deadlineManual ? p.clientDeadline : "");

  const bar = (
    <div className="relative h-6 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: battery }} />
      <span className="absolute inset-0 grid place-items-center text-2xs font-semibold text-[var(--color-ink)]">
        {fmtShort(p.shootDate)} – {fmtShort(p.clientDeadline)}{p.deadlineManual ? " ✎" : ""}
      </span>
    </div>
  );

  if (!canEdit) return <div className="flex items-center p-1">{bar}</div>;

  return (
    <div className="relative flex items-center p-1">
      <button type="button" onClick={() => { setVal(p.deadlineManual ? p.clientDeadline : ""); setOpen((o) => !o); }} className="w-full" title="Deadline aanpassen">
        {bar}
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-1 top-full z-20 mt-1 flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-raised)]">
            <input type="date" value={val} onChange={(e) => setVal(e.target.value)} className="sc-input h-8 w-36 py-0 text-xs" />
            <button type="button" onClick={() => { onSave(val || null); setOpen(false); }} className="shrink-0 rounded bg-[var(--color-ink)] px-2 py-1.5 text-2xs font-semibold text-white">Opslaan</button>
            {p.deadlineManual ? (
              <button type="button" onClick={() => { onSave(null); setOpen(false); }} className="shrink-0 rounded px-2 py-1.5 text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" title="Terug naar automatisch (opname + 14 werkdagen)">Auto</button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ShortsField({ p, canEdit, onSave }: { p: EditingProject; canEdit: boolean; onSave: (n: number | null) => void }) {
  // Als er niets is ingevuld, tonen we de klant-standaard (maandquota) als
  // voorstel — bij veel klanten is dat elke opname hetzelfde.
  const fallback = p.clientDefaultShorts > 0 ? p.clientDefaultShorts : null;
  const shown = p.plannedShorts ?? fallback;
  const [val, setVal] = useState(p.plannedShorts === null ? "" : String(p.plannedShorts));
  if (!canEdit) return <span className="tabular-nums">{shown ?? "—"}</span>;
  return (
    <input
      type="number"
      min={0}
      value={val}
      placeholder={fallback !== null ? String(fallback) : ""}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { const n = val === "" ? null : Number(val); if (n !== p.plannedShorts) onSave(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-7 w-12 rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1 text-center text-sm tabular-nums placeholder:text-[var(--color-ink-faint)]"
      aria-label="Aantal shorts"
      title={fallback !== null ? `Standaard voor deze klant: ${fallback} · ${p.shortsCount} klaar` : `${p.shortsCount} klaar`}
    />
  );
}

function LinkEditor({ current, icon, label, title, onSave }: { current: string | null; icon: React.ReactNode; label?: string; title: string; onSave: (u: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current ?? "");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title={title}
        className={label ? "inline-flex items-center gap-1 rounded-[4px] border border-dashed border-[var(--color-line-strong)] px-1.5 py-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" : "grid size-6 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"}>
        {icon}{label ? <span>{label}</span> : null}
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
          {editors.map((e) => <option key={e.id} value={e.id}>{editorDisplayName(e.fullName)}</option>)}
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
