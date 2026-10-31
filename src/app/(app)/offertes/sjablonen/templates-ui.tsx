"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArchiveRestore, Copy, Loader2, Pencil, Plus } from "lucide-react";
import { archiveTemplate, createTemplate, duplicateTemplate } from "@/server/actions/quotes";

type Tpl = { id: string; name: string; description: string | null; isArchived: boolean; updatedAt: Date };

export function TemplatesUI({ templates }: { templates: Tpl[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  function add() {
    if (!name.trim()) return;
    start(async () => {
      const res = await createTemplate({ name });
      if (res.ok && res.id) router.push(`/offertes/sjablonen/${res.id}`);
    });
  }

  return (
    <div className="space-y-4">
      {adding ? (
        <div className="sc-card flex flex-wrap items-center gap-2 p-3">
          <input autoFocus className="sc-input h-9 min-w-56 flex-1" placeholder="Naam van het sjabloon" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <button type="button" disabled={pending || !name.trim()} onClick={add} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Aanmaken</button>
          <button type="button" onClick={() => setAdding(false)} className="px-2 py-2 text-sm text-[var(--color-ink-muted)]">Annuleren</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"><Plus className="size-4" /> Nieuw sjabloon</button>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <div key={t.id} className={`sc-card p-4 ${t.isArchived ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/offertes/sjablonen/${t.id}`} className="font-semibold hover:underline">{t.name}</Link>
                {t.description ? <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-ink-muted)]">{t.description}</p> : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Link href={`/offertes/sjablonen/${t.id}`} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-2xs font-semibold hover:bg-[var(--color-surface-sunken)]"><Pencil className="size-3" /> Bewerken</Link>
              <Link href={`/offertes/nieuw`} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-2xs font-semibold hover:bg-[var(--color-surface-sunken)]"><Plus className="size-3" /> Nieuwe offerte</Link>
              <button type="button" disabled={pending} onClick={() => start(async () => { const r = await duplicateTemplate(t.id); if (r.ok && r.id) router.push(`/offertes/sjablonen/${r.id}`); })} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]"><Copy className="size-3" /> Dupliceren</button>
              <button type="button" disabled={pending} onClick={() => start(async () => { await archiveTemplate(t.id, !t.isArchived); router.refresh(); })} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                {t.isArchived ? <><ArchiveRestore className="size-3" /> Terugzetten</> : <><Archive className="size-3" /> Archiveren</>}
              </button>
            </div>
          </div>
        ))}
        {templates.length === 0 ? <p className="text-sm text-[var(--color-ink-muted)]">Nog geen sjablonen. Maak er één aan om snel offertes te kunnen samenstellen.</p> : null}
      </div>
    </div>
  );
}
