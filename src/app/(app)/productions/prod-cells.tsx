"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { changeProductionStatus, setProductionVideographer } from "@/server/actions/productions";
import { PRODUCTION_STATUS } from "@/lib/statuses";

export type PersonOption = { id: string; fullName: string };

const STATUS_ENTRIES = Object.entries(PRODUCTION_STATUS) as [string, { label: string }][];

// Klikken op de inline-bediening mag de klikbare kaart niet laten navigeren.
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function useSaver() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setErr(null);
      const res = await fn();
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Mislukt");
    });
  return { pending, err, run };
}

export function ProdStatusCell({ id, status }: { id: string; status: string }) {
  const { pending, err, run } = useSaver();
  return (
    <span className="inline-flex items-center gap-1" onClick={stop} onMouseDown={stop} title={err ?? undefined}>
      <select
        className="sc-input h-7 w-28 py-0 text-xs"
        value={status}
        disabled={pending}
        onChange={(e) => run(() => changeProductionStatus(id, e.target.value))}
      >
        {STATUS_ENTRIES.map(([key, s]) => (
          <option key={key} value={key}>{s.label}</option>
        ))}
      </select>
      {pending ? <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" /> : null}
      {err ? <span className="text-2xs text-[var(--color-bad)]">!</span> : null}
    </span>
  );
}

export function VideographerCell({ id, videographerId, options }: { id: string; videographerId: string | null; options: PersonOption[] }) {
  const { pending, err, run } = useSaver();
  return (
    <span className="inline-flex items-center gap-1" onClick={stop} onMouseDown={stop} title={err ?? undefined}>
      <select
        className="sc-input h-7 w-32 py-0 text-xs"
        value={videographerId ?? ""}
        disabled={pending}
        onChange={(e) => run(() => setProductionVideographer(id, e.target.value || null))}
      >
        <option value="">— Geen videograaf —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.fullName}</option>
        ))}
      </select>
      {pending ? <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" /> : null}
      {err ? <span className="text-2xs text-[var(--color-bad)]">!</span> : null}
    </span>
  );
}
