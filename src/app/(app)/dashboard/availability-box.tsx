"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Check, Loader2 } from "lucide-react";
import { setMyAvailabilityNote } from "@/server/actions/availability";

/**
 * Beschikbaarheidsvak op Vandaag: hier geef je zelf aan welke dagen/tijden je
 * niet beschikbaar bent, zodat het team daar rekening mee kan houden.
 */
export function AvailabilityBox({ note }: { note: string | null }) {
  const [val, setVal] = useState(note ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const dirty = val.trim() !== (note ?? "").trim();
  const save = () => {
    if (!dirty) return;
    setSaved(false);
    start(async () => {
      await setMyAvailabilityNote(val);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)]">
      <div className="mb-1 flex items-center gap-2">
        <CalendarOff className="size-4 text-[var(--color-warn)]" />
        <h2 className="text-sm font-bold tracking-tight">Mijn beschikbaarheid</h2>
      </div>
      <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
        Geef hier aan welke dagen of tijden je <strong>niet</strong> beschikbaar bent, zodat het team ermee rekening
        houdt. Bijvoorbeeld: &ldquo;woensdagmiddag niet, en 28 okt vrij&rdquo;.
      </p>
      <textarea
        value={val}
        onChange={(e) => {
          setVal(e.target.value);
          setSaved(false);
        }}
        onBlur={save}
        maxLength={500}
        rows={2}
        placeholder="Wanneer ben je niet beschikbaar?"
        className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand-500)] focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {pending ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]"><Loader2 className="size-3.5 animate-spin" /> Opslaan…</span>
        ) : saved && !dirty ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-good)]"><Check className="size-3.5" /> Opgeslagen</span>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Opslaan
        </button>
      </div>
    </div>
  );
}
