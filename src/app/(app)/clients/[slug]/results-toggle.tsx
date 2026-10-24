"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setClientShowInResults } from "@/server/actions/clients";

/**
 * Tonen op de resultatenpagina? Op "nee" voor records die geen echte klant van
 * ons zijn, zodat ze uit de resultaten verdwijnen. Niet-destructief: de klant
 * blijft elders in het systeem gewoon bestaan.
 */
export function ResultsToggle({ clientId, initial, canEdit }: { clientId: string; initial: boolean; canEdit: boolean }) {
  const [show, setShow] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();

  const set = (v: boolean) => {
    if (pending || v === show) return;
    setShow(v);
    start(async () => { await setClientShowInResults(clientId, v); router.refresh(); });
  };

  if (!canEdit) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${show ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]"}`}>
        {show ? "In resultaten" : "Verborgen"}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5 text-xs">
        <button type="button" onClick={() => set(true)} disabled={pending} className={`rounded-full px-2.5 py-1 font-medium transition ${show ? "bg-[var(--color-good)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>Tonen</button>
        <button type="button" onClick={() => set(false)} disabled={pending} className={`rounded-full px-2.5 py-1 font-medium transition ${!show ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>Verbergen</button>
      </span>
      {pending ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : null}
    </span>
  );
}
