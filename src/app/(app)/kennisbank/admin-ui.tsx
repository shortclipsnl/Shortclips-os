"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { createCourse, deleteCourse, moveCourse, updateCourse } from "@/server/actions/kennisbank";
import { uploadKbFile } from "@/components/kennisbank/upload";
import type { CourseCard } from "@/server/kennisbank";

export const ROLE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "admin", label: "Beheerder" },
  { key: "project_coordinator", label: "Projectcoördinator" },
  { key: "content_creator", label: "Content creator" },
  { key: "videographer", label: "Videograaf" },
  { key: "editor", label: "Editor" },
  { key: "finance", label: "Finance" },
];

type CourseFormValue = Pick<CourseCard, "title" | "description" | "coverAssetId" | "isRestricted" | "allowedRoles" | "isPublished">;

export function CourseFormDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: CourseFormValue;
  onClose: () => void;
  onSave: (v: CourseFormValue) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [v, setV] = useState<CourseFormValue>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  async function onCover(file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      setUploadPct(0);
      const a = await uploadKbFile(file, setUploadPct);
      setV((s) => ({ ...s, coverAssetId: a.id }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploadPct(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-[var(--color-surface)] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Cursus</h2>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-[var(--color-surface-2)]" aria-label="Sluiten">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="block text-sm font-medium">
          Titel
          <input className="mt-1 w-full" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </label>
        <label className="mt-3 block text-sm font-medium">
          Beschrijving
          <textarea className="mt-1 w-full" rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </label>
        <div className="mt-3 text-sm font-medium">Cursusafbeelding</div>
        <div className="mt-1 flex items-center gap-3">
          <div className="aspect-[1460/752] w-40 overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)]">
            {v.coverAssetId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/kennisbank/assets/${v.coverAssetId}`} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <label className="cursor-pointer rounded-md border border-[var(--color-line-strong)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]">
            {uploadPct !== null ? `Uploaden… ${uploadPct}%` : "Afbeelding kiezen"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onCover(e.target.files?.[0])} />
          </label>
        </div>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Aanbevolen formaat 1460 × 752 pixels.</p>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.isPublished} onChange={(e) => setV({ ...v, isPublished: e.target.checked })} />
          Gepubliceerd (zichtbaar voor het team)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.isRestricted} onChange={(e) => setV({ ...v, isRestricted: e.target.checked })} />
          Afgeschermd: alleen voor gekozen rollen
        </label>
        {v.isRestricted ? (
          <div className="mt-2 flex flex-wrap gap-2 pl-6">
            {ROLE_OPTIONS.map((r) => (
              <label key={r.key} className="flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={v.allowedRoles.includes(r.key)}
                  onChange={(e) =>
                    setV({ ...v, allowedRoles: e.target.checked ? [...v.allowedRoles, r.key] : v.allowedRoles.filter((x) => x !== r.key) })
                  }
                />
                {r.label}
              </label>
            ))}
          </div>
        ) : null}

        {err ? <p className="mt-3 text-sm text-[var(--color-bad)]">{err}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]">
            Annuleren
          </button>
          <button
            type="button"
            disabled={busy || uploadPct !== null}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              const res = await onSave(v);
              setBusy(false);
              if (!res.ok) setErr(res.message ?? "Opslaan mislukt.");
              else onClose();
            }}
            className="rounded-md bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NewCourseCard() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-line-strong)] text-sm font-medium text-[var(--color-ink-muted)] hover:border-[var(--color-brand-500)] hover:text-[var(--color-ink)]"
      >
        <Plus className="h-5 w-5" />
        Nieuwe cursus
      </button>
      {open ? (
        <CourseFormDialog
          initial={{ title: "", description: "", coverAssetId: null, isRestricted: false, allowedRoles: [], isPublished: false }}
          onClose={() => setOpen(false)}
          onSave={async (v) => {
            const res = await createCourse(v);
            if (res.ok && res.id) router.push(`/kennisbank/${res.id}`);
            return res;
          }}
        />
      ) : null}
    </>
  );
}

export function CourseAdminMenu({ course, isFirst, isLast }: { course: CourseCard; isFirst: boolean; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      setOpen(false);
      router.refresh();
    });
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-black/45 p-1.5 text-white backdrop-blur hover:bg-black/65"
        aria-label="Cursus beheren"
        disabled={pending}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-1 text-sm shadow-lg">
          <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setEditing(true); setOpen(false); }}>Bewerken</MenuItem>
          {!isFirst ? <MenuItem icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => run(() => moveCourse(course.id, -1))}>Naar voren</MenuItem> : null}
          {!isLast ? <MenuItem icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => run(() => moveCourse(course.id, 1))}>Naar achteren</MenuItem> : null}
          <MenuItem
            danger
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => {
              if (window.confirm(`Cursus "${course.title}" verwijderen? Dit is te herstellen door een beheerder in de database.`)) run(() => deleteCourse(course.id));
            }}
          >
            Verwijderen
          </MenuItem>
        </div>
      ) : null}
      {editing ? (
        <CourseFormDialog
          initial={course}
          onClose={() => setEditing(false)}
          onSave={async (v) => {
            const res = await updateCourse(course.id, v);
            if (res.ok) router.refresh();
            return res;
          }}
        />
      ) : null}
    </div>
  );
}

export function MenuItem({ children, icon, onClick, danger }: { children: React.ReactNode; icon?: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-surface-2)] ${danger ? "text-[var(--color-bad)]" : ""}`}
    >
      {icon}
      {children}
    </button>
  );
}
