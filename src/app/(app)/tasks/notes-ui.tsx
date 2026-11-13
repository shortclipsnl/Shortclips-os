"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown, ListChecks, ListPlus, Loader2, NotebookPen, Pencil, StickyNote, Trash2, Users, X } from "lucide-react";
import { convertNoteToTask, createNote, deleteNote, updateNote } from "@/server/actions/notes";
import { Button, Card, ErrorNote } from "@/components/ui";
import { cn } from "@/lib/cn";

export type NoteItem = {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  /** Gezet wanneer de notitie als taak op de takenlijst staat. */
  taskId: string | null;
  taskDone: boolean;
};

function when(iso: string): string {
  const d = new Date(iso);
  const tz = "Europe/Amsterdam";
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const now = new Date();
  const yest = new Date(now.getTime() - 86_400_000);
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  if (day(d) === day(now)) return `vandaag ${time}`;
  if (day(d) === day(yest)) return `gisteren ${time}`;
  return `${d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: tz })} ${time}`;
}

/* ------------------------------------------------------------------ *
 * Knoppenbalk bovenaan de takenpagina
 * ------------------------------------------------------------------ */

/**
 * Drie vaste knoppen: Mijn taken, Bekijk taken van collega's en Maak notitie.
 * De personenkaarten (children) verschijnen pas na een klik op de
 * collega-knop; bij het bekijken van een collega staat de rij al open.
 */
export function TasksTopBar({ isOwnView, colleaguesOpen, children }: { isOwnView: boolean; colleaguesOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(colleaguesOpen);
  const [noteOpen, setNoteOpen] = useState(false);

  const base =
    "inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border px-3.5 text-sm font-medium transition-colors";
  const idle = "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]";
  const active = "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white";

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        <Link href="/tasks" className={cn(base, isOwnView && !open ? active : idle)} aria-current={isOwnView ? "page" : undefined}>
          <ListChecks className="size-4 shrink-0" />
          Mijn taken
        </Link>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn(base, open || !isOwnView ? active : idle)}>
          <Users className="size-4 shrink-0" />
          <span className="sm:hidden">Collega&apos;s</span>
          <span className="hidden sm:inline">Bekijk taken van collega&apos;s</span>
          <ChevronDown className={cn("hidden size-4 shrink-0 opacity-70 transition-transform sm:block", open && "rotate-180")} />
        </button>
        <button type="button" onClick={() => setNoteOpen(true)} className={cn(base, idle, "sm:ml-auto")}>
          <NotebookPen className="size-4 shrink-0" />
          <span className="sm:hidden">Notitie</span>
          <span className="hidden sm:inline">Maak notitie</span>
        </button>
      </div>
      {open ? <div className="mt-3">{children}</div> : null}
      {noteOpen ? <NoteDialog onClose={() => setNoteOpen(false)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Venster om een notitie te maken of te bewerken
 * ------------------------------------------------------------------ */

export function NoteDialog({ note, onClose }: { note?: NoteItem; onClose: () => void }) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    if (!title.trim()) {
      setErr("Geef de notitie een korte titel.");
      return;
    }
    start(async () => {
      const res = note ? await updateNote(note.id, { title, body }) : await createNote({ title, body });
      if (res.ok) {
        onClose();
        router.refresh();
      } else setErr(res.message ?? "Opslaan mislukt.");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 text-left text-[var(--color-ink)] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={note ? "Notitie bewerken" : "Notitie maken"}
        className="flex max-h-[100dvh] w-full flex-col rounded-t-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)] sm:max-w-lg sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <NotebookPen className="size-4 text-[var(--color-brand-600)]" />
            {note ? "Notitie bewerken" : "Maak notitie"}
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]" aria-label="Sluiten">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
          <div>
            <label htmlFor="note-title" className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Titel</label>
            <input
              id="note-title"
              ref={titleRef}
              className="sc-input w-full"
              maxLength={160}
              placeholder="Bijv. Koops terugbellen over opnamedatum"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
            />
          </div>
          <div>
            <label htmlFor="note-body" className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Tekst <span className="font-normal text-[var(--color-ink-faint)]">(optioneel)</span></label>
            <textarea
              id="note-body"
              className="sc-input w-full resize-y text-sm leading-relaxed"
              rows={5}
              maxLength={5000}
              placeholder="Wat wil je onthouden?"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              }}
            />
          </div>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--color-line)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <Button onClick={save} disabled={pending || !title.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Opslaan
          </Button>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            Annuleren
          </button>
          <span className="ml-auto hidden text-xs text-[var(--color-ink-faint)] sm:inline">Alleen zichtbaar voor jou</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overzicht met de meest recente notities
 * ------------------------------------------------------------------ */

const VISIBLE = 4;

export function RecentNotes({ notes }: { notes: NoteItem[] }) {
  const [showAll, setShowAll] = useState(false);
  if (notes.length === 0) return null;
  const list = showAll ? notes : notes.slice(0, VISIBLE);

  return (
    <div className="min-w-0">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="size-2 shrink-0 rounded-full bg-[var(--color-violet)]" />
        Mijn notities
        <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-muted)]">{notes.length}</span>
        <span className="ml-1 text-xs font-normal text-[var(--color-ink-faint)]">alleen zichtbaar voor jou</span>
      </h2>
      <Card padded={false}>
        <ul className="divide-y divide-[var(--color-line)]">
          {list.map((n) => (
            <NoteRow key={n.id} note={n} />
          ))}
        </ul>
        {notes.length > VISIBLE ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex w-full items-center justify-center gap-1 border-t border-[var(--color-line)] px-4 py-2 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]"
          >
            {showAll ? "Minder tonen" : `Alle notities tonen (${notes.length})`}
            <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
          </button>
        ) : null}
      </Card>
    </div>
  );
}

function NoteRow({ note }: { note: NoteItem }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function toTask() {
    setErr(null);
    start(async () => {
      const res = await convertNoteToTask(note.id);
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Omzetten mislukt.");
    });
  }
  function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    start(async () => {
      const res = await deleteNote(note.id);
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Verwijderen mislukt.");
    });
  }

  const iconBtn = "shrink-0 rounded p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:opacity-50";

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--color-violet)_15%,transparent)] text-[var(--color-violet)]" aria-hidden>
          <StickyNote className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{note.title}</p>
          {note.body ? <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-ink-muted)]">{note.body}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-[var(--color-ink-faint)]">
            {when(note.createdAt)}
            {note.taskId ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-[var(--color-ink-muted)]">
                <Check className="size-3" /> {note.taskDone ? "Taak afgerond" : "Op je takenlijst"}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!note.taskId ? (
            <button type="button" onClick={toTask} disabled={pending} className={cn(iconBtn, "flex items-center gap-1 text-xs font-medium")} title="Zet deze notitie als taak op je takenlijst">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
              <span className="hidden sm:inline">Maak taak</span>
            </button>
          ) : null}
          <button type="button" onClick={() => setEditing(true)} disabled={pending} className={iconBtn} aria-label="Notitie bewerken" title="Bewerken">
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className={cn(iconBtn, "hover:text-[var(--color-bad)]", confirmDelete && "bg-[var(--color-bad)] text-white hover:bg-[var(--color-bad)] hover:text-white")}
            aria-label={confirmDelete ? "Klik nogmaals om te verwijderen" : "Notitie verwijderen"}
            title={confirmDelete ? "Klik nogmaals om te verwijderen" : "Verwijderen"}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {err ? <div className="mt-2 ml-9"><ErrorNote>{err}</ErrorNote></div> : null}
      {editing ? <NoteDialog note={note} onClose={() => setEditing(false)} /> : null}
    </li>
  );
}
