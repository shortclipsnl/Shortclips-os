"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { upsertEditorRate } from "@/server/actions/editor-rates";

export type RateEditor = { id: string; name: string; rate: number; capacity: number; has_rate: boolean };

export function RateRow({ editor }: { editor: RateEditor }) {
  const [rate, setRate] = useState(String(editor.rate || ""));
  const [cap, setCap] = useState(String(editor.capacity || ""));
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    start(async () => {
      const res = await upsertEditorRate({ userId: editor.id, ratePerVideo: Number(rate) || 0, capacityPerWeek: Number(cap) || 0 });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500); router.refresh(); }
    });
  }
  const cell = "w-24 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1 text-right text-sm tabular-nums";

  return (
    <tr className="border-b border-[var(--color-line)]">
      <td className="px-5 py-2 text-sm font-medium">{editor.name}</td>
      <td className="px-2 py-2 text-right">
        <span className="inline-flex items-center gap-1"><span className="text-xs text-[var(--color-ink-faint)]">€</span>
          <input className={cell} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" /></span>
      </td>
      <td className="px-2 py-2 text-right">
        <input className={cell} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="0" />
      </td>
      <td className="px-3 py-2 text-right">
        <button type="button" onClick={save} disabled={pending}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--color-indigo-soft)]">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
          {saved ? "Opgeslagen" : "Opslaan"}
        </button>
      </td>
    </tr>
  );
}
