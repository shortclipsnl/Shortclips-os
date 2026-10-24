"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setClientPosting } from "@/server/actions/clients";

/**
 * Plaatst Shortclips de content voor deze klant, of post de klant zelf?
 * Zichtbaar + (met recht) instelbaar. Bij "klant plaatst zelf" vervallen de
 * inplannen/publiceren-signalen bij Kwaliteit & Aandachtspunten en toont de
 * contentplanning dat de klant zelf post.
 */
export function PostingToggle({ clientId, initial, canEdit }: { clientId: string; initial: boolean; canEdit: boolean }) {
  const [we, setWe] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();

  const set = (v: boolean) => {
    if (pending || v === we) return;
    setWe(v);
    start(async () => { await setClientPosting(clientId, v); router.refresh(); });
  };

  if (!canEdit) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${we ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-warn-soft)] text-[#8a5300]"}`}>
        {we ? "Shortclips plaatst" : "Klant plaatst zelf"}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5 text-xs">
        <button type="button" onClick={() => set(true)} disabled={pending} className={`rounded-full px-2.5 py-1 font-medium transition ${we ? "bg-[var(--color-good)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>Shortclips plaatst</button>
        <button type="button" onClick={() => set(false)} disabled={pending} className={`rounded-full px-2.5 py-1 font-medium transition ${!we ? "bg-[var(--color-warn)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>Klant plaatst zelf</button>
      </span>
      {pending ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : null}
    </span>
  );
}
