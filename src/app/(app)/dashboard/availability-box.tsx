"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Loader2, Pencil } from "lucide-react";
import { setMyAvailabilityNote } from "@/server/actions/availability";

/**
 * Beschikbaarheidsvak op Vandaag: hier geef je zelf aan wanneer je niet
 * beschikbaar bent. Eén punt per regel; die staan als bolletjes onder elkaar,
 * zodat het voor het team in één oogopslag duidelijk is.
 */
export function AvailabilityBox({ note }: { note: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const items = (note ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const [editing, setEditing] = useState(items.length === 0);
  const [val, setVal] = useState(note ?? "");

  const save = () => {
    start(async () => {
      await setMyAvailabilityNote(val);
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)]">
      <div className="mb-1 flex items-center gap-2">
        <CalendarOff className="size-4 text-[var(--color-warn)]" />
        <h2 className="text-sm font-bold tracking-tight">Mijn beschikbaarheid</h2>
        {!editing ? (
          <button type="button" onClick={() => setEditing(true)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline">
            <Pencil className="size-3.5" /> Aanpassen
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
        Geef aan wanneer je <strong>niet</strong> beschikbaar bent — <strong>één punt per regel</strong>. Bijvoorbeeld:
        &ldquo;woensdagmiddag niet&rdquo; en op de volgende regel &ldquo;28 okt vrij&rdquo;.
      </p>

      {editing ? (
        <>
          <textarea
            value={val}
            onChange={(e) => setVal(e.target.value)}
            maxLength={1000}
            rows={4}
            placeholder={"Woensdagmiddag niet\n28 okt vrij\n..."}
            className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand-500)] focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            {items.length > 0 ? (
              <button type="button" onClick={() => { setVal(note ?? ""); setEditing(false); }} className="text-xs text-[var(--color-ink-muted)]">Annuleren</button>
            ) : null}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
            </button>
          </div>
        </>
      ) : items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--color-ink)]">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-warn)]" />
              <span className="min-w-0">{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-ink-muted)]">Nog niets ingevuld.</p>
      )}
    </div>
  );
}
