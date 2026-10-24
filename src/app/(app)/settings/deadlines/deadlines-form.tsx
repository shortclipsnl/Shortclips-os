"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { updateDeadlineSetting } from "@/server/actions/deadline-settings";

type Def = { key: string; label: string; description: string; unit: string; default: number; min: number; max: number };

export function DeadlinesForm({ defs, initial }: { defs: Def[]; initial: Record<string, number> }) {
  const [values, setValues] = useState<Record<string, number>>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = defs.some((d) => values[d.key] !== initial[d.key]);

  const set = (key: string, raw: string) => {
    const n = Number(raw);
    setSaved(false);
    setValues((v) => ({ ...v, [key]: Number.isFinite(n) ? n : v[key]! }));
  };

  const save = () => {
    setErr(null);
    start(async () => {
      for (const d of defs) {
        if (values[d.key] === initial[d.key]) continue;
        const res = await updateDeadlineSetting(d.key, values[d.key]!);
        if (!res.ok) { setErr(res.message); return; }
        // Server klemt de waarde binnen de grenzen; neem die over.
        setValues((v) => ({ ...v, [d.key]: res.value }));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
        {defs.map((d) => (
          <li key={d.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--color-ink)]">{d.label}</p>
              <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{d.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                type="number"
                min={d.min}
                max={d.max}
                value={values[d.key] ?? d.default}
                onChange={(e) => set(d.key, e.target.value)}
                className="h-9 w-20 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 text-right text-sm tabular-nums text-[var(--color-ink)] focus:border-[var(--color-brand-500)] focus:outline-none"
              />
              <span className="w-16 text-xs text-[var(--color-ink-faint)]">{d.unit}</span>
              {values[d.key] !== d.default ? (
                <button type="button" onClick={() => set(d.key, String(d.default))} title={`Terug naar standaard (${d.default})`} className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                  <RotateCcw className="size-3.5" />
                </button>
              ) : <span className="w-[22px]" />}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
          {saved ? "Opgeslagen" : "Termijnen opslaan"}
        </button>
        {dirty && !pending ? <span className="text-xs text-[var(--color-ink-muted)]">Niet-opgeslagen wijzigingen</span> : null}
        {err ? <span className="text-xs text-[var(--color-bad)]">{err}</span> : null}
      </div>
    </div>
  );
}
