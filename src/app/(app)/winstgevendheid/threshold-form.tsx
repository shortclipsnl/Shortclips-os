"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import { updateProfitSettings } from "@/server/actions/profitability";

export function ThresholdForm({ green, orange, includeOverhead }: { green: number; orange: number; includeOverhead: boolean }) {
  const [g, setG] = useState(green);
  const [o, setO] = useState(orange);
  const [ov, setOv] = useState(includeOverhead);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  function save() {
    setSaved(false);
    start(async () => {
      const res = await updateProfitSettings({ marginGreenPct: g, marginOrangePct: Math.min(o, g), includeOverhead: ov });
      if (res.ok) { setSaved(true); router.refresh(); }
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">
        <SlidersHorizontal className="size-4" /> Grenswaarden
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <label className="text-xs">
        <span className="mb-0.5 block font-semibold text-[var(--color-good)]">🟢 Groen vanaf (%)</span>
        <input type="number" value={g} onChange={(e) => setG(Number(e.target.value))} className="w-20 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1 text-sm" />
      </label>
      <label className="text-xs">
        <span className="mb-0.5 block font-semibold text-[var(--color-warn)]">🟠 Oranje vanaf (%)</span>
        <input type="number" value={o} onChange={(e) => setO(Number(e.target.value))} className="w-20 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1 text-sm" />
      </label>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={ov} onChange={(e) => setOv(e.target.checked)} />
        <span className="font-medium text-[var(--color-ink)]">Overhead meenemen (geschat)</span>
      </label>
      <button type="button" onClick={save} disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null} Opslaan
      </button>
      <p className="w-full text-2xs text-[var(--color-ink-faint)]">Onder de oranjegrens kleurt een klant rood. Oranje kan niet boven groen liggen.</p>
    </div>
  );
}
