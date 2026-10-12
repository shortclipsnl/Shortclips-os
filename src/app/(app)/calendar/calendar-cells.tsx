"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { updateCalendarItem } from "@/server/actions/calendar";
import { PUBLICATION_STATUS } from "@/lib/statuses";

const STATUS_ENTRIES = Object.entries(PUBLICATION_STATUS) as [string, { label: string }][];

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

/** Publicatiedatum verplaatsen vanuit de lijst. */
export function CalDateCell({ id, scheduledOn }: { id: string; scheduledOn: string }) {
  const { pending, err, run } = useSaver();
  const [val, setVal] = useState(scheduledOn);
  return (
    <span className="inline-flex items-center gap-1" title={err ?? undefined}>
      <input
        type="date"
        className="sc-input h-7 w-32 py-0 text-xs"
        value={val}
        disabled={pending}
        onChange={(e) => { if (!e.target.value) return; setVal(e.target.value); run(() => updateCalendarItem(id, { scheduledOn: e.target.value })); }}
      />
      {pending ? <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" /> : null}
      {err ? <span className="text-2xs text-[var(--color-bad)]">!</span> : null}
    </span>
  );
}

/** Publicatiestatus wijzigen vanuit de lijst. */
export function CalStatusCell({ id, status }: { id: string; status: string }) {
  const { pending, err, run } = useSaver();
  return (
    <span className="inline-flex items-center gap-1" title={err ?? undefined}>
      <select
        className="sc-input h-7 w-32 py-0 text-xs"
        value={status}
        disabled={pending}
        onChange={(e) => run(() => updateCalendarItem(id, { status: e.target.value as "ready" }))}
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
