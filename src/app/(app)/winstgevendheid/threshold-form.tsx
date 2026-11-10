"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import { updateProfitSettings } from "@/server/actions/profitability";

type Props = {
  green: number;
  orange: number;
  includeOverhead: boolean;
  internUurtarief: number;
  internUrenPerKlant: number;
  vgUurtarief: number;
  overheadKantoor: number;
  overheadSoftware: number;
  overheadOverig: number;
};

function NumField({ label, value, set, step = "1", prefix }: { label: string; value: number; set: (n: number) => void; step?: string; prefix?: string }) {
  return (
    <label className="text-xs">
      <span className="mb-0.5 block font-semibold text-[var(--color-ink-muted)]">{label}</span>
      <span className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]">
        {prefix ? <span className="pl-2 text-sm text-[var(--color-ink-faint)]">{prefix}</span> : null}
        <input type="number" step={step} min="0" value={value} onChange={(e) => set(Number(e.target.value))} className="w-20 bg-transparent px-2 py-1 text-sm outline-none" />
      </span>
    </label>
  );
}

export function ThresholdForm(p: Props) {
  const [g, setG] = useState(p.green);
  const [o, setO] = useState(p.orange);
  const [ov, setOv] = useState(p.includeOverhead);
  const [internRate, setInternRate] = useState(p.internUurtarief);
  const [internUren, setInternUren] = useState(p.internUrenPerKlant);
  const [vgRate, setVgRate] = useState(p.vgUurtarief);
  const [ohK, setOhK] = useState(p.overheadKantoor);
  const [ohS, setOhS] = useState(p.overheadSoftware);
  const [ohO, setOhO] = useState(p.overheadOverig);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  function save() {
    setSaved(false);
    start(async () => {
      const res = await updateProfitSettings({
        marginGreenPct: g, marginOrangePct: Math.min(o, g), includeOverhead: ov,
        internUurtarief: internRate, internUrenPerKlant: internUren, vgUurtarief: vgRate,
        overheadKantoor: ohK, overheadSoftware: ohS, overheadOverig: ohO,
      });
      if (res.ok) { setSaved(true); router.refresh(); }
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">
        <SlidersHorizontal className="size-4" /> Instellingen
      </button>
    );
  }
  return (
    <div className="w-full max-w-[560px] rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5">
      <div className="mb-2 text-2xs font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">Grenswaarden marge</div>
      <div className="flex flex-wrap items-end gap-3">
        <NumField label="🟢 Groen vanaf (%)" value={g} set={setG} />
        <NumField label="🟠 Oranje vanaf (%)" value={o} set={setO} />
      </div>

      <div className="mb-2 mt-4 text-2xs font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">Tarieven</div>
      <div className="flex flex-wrap items-end gap-3">
        <NumField label="Intern uurtarief" value={internRate} set={setInternRate} prefix="€" />
        <NumField label="Interne uren / klant" value={internUren} set={setInternUren} step="0.5" />
        <NumField label="Videograaf / uur" value={vgRate} set={setVgRate} step="0.25" prefix="€" />
      </div>

      <div className="mb-2 mt-4 flex items-center justify-between gap-2">
        <span className="text-2xs font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">Overhead per maand</span>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={ov} onChange={(e) => setOv(e.target.checked)} />
          <span className="font-medium text-[var(--color-ink)]">Meenemen in nettowinst</span>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <NumField label="Kantoor" value={ohK} set={setOhK} prefix="€" />
        <NumField label="Software" value={ohS} set={setOhS} prefix="€" />
        <NumField label="Overig" value={ohO} set={setOhO} prefix="€" />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null} Opslaan
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Sluiten</button>
      </div>
      <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Interne kosten per klant = interne uren × intern uurtarief. Zonder ingevulde overhead tonen we geen definitieve nettowinst. Historische maanden blijven ongewijzigd.</p>
    </div>
  );
}
