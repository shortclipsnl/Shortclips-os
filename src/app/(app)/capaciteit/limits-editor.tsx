"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import { updateCapacityLimits } from "@/server/actions/capacity";

/**
 * Eigenaar-only inline editor voor de capaciteitsgrenzen van één persoon.
 * Hiermee stel je de werkelijke capaciteit realistisch in (groen / oranje /
 * plafond) zodat de weergave niet onnodig rood kleurt. Compact en uitklapbaar.
 */
export function CapacityLimitsEditor({
  id,
  unitLabel,
  green,
  orange,
  max,
}: {
  id: string;
  unitLabel: string;
  green: number | null;
  orange: number | null;
  max: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [g, setG] = useState(green?.toString() ?? "");
  const [o, setO] = useState(orange?.toString() ?? "");
  const [m, setM] = useState(max?.toString() ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    setErr(null);
    const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
    start(async () => {
      const res = await updateCapacityLimits({ id, limitGreen: num(g), limitOrange: num(o), limitMax: num(m) });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
        router.refresh();
      } else {
        setErr(res.message ?? "Opslaan mislukt.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
      >
        <SlidersHorizontal className="size-3" /> Grenzen aanpassen
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-2.5">
      <p className="mb-1.5 text-2xs text-[var(--color-ink-faint)]">Grenzen in {unitLabel} — leeg = geen grens</p>
      <div className="grid grid-cols-3 gap-1.5">
        {([
          ["Groen", g, setG] as const,
          ["Oranje", o, setO] as const,
          ["Plafond", m, setM] as const,
        ]).map(([label, val, set]) => (
          <label key={label} className="flex flex-col gap-0.5 text-2xs text-[var(--color-ink-muted)]">
            {label}
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={val}
              onChange={(e) => set(e.target.value)}
              className="sc-input rounded-md px-2 py-1 text-sm tabular-nums"
            />
          </label>
        ))}
      </div>
      {err ? <p className="mt-1.5 text-2xs text-[var(--color-bad)]">{err}</p> : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--color-indigo-ink)] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : saved ? <Check className="size-3" /> : null}
          {saved ? "Opgeslagen" : "Opslaan"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
          Sluiten
        </button>
      </div>
    </div>
  );
}
