"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send } from "lucide-react";
import { shareContentPlanning } from "@/server/actions/content-approval";

/**
 * "Goedkeuren en delen met klant" — maakt de geplande content zichtbaar in het
 * klantportaal. Toont hoeveel conceptitems nog niet gedeeld zijn.
 */
export function SharePlanningButton({ clientId, clientName, unshared }: { clientId: string; clientName: string; unshared: number }) {
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function share() {
    setErr(null);
    start(async () => {
      const res = await shareContentPlanning(clientId);
      if (res.ok) { setDone(res.shared ?? 0); router.refresh(); }
      else setErr(res.message ?? "Mislukt.");
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-50)] px-4 py-3">
      <div className="text-sm">
        <span className="font-semibold">Planning van {clientName}</span>
        <span className="text-[var(--color-ink-muted)]">
          {" — "}
          {unshared > 0
            ? `${unshared} item${unshared === 1 ? "" : "s"} nog niet gedeeld met de klant.`
            : "alle geplande content is gedeeld met de klant."}
        </span>
        {done != null ? <span className="ml-1 font-medium text-[var(--color-good)]">{done} nieuw gedeeld.</span> : null}
        {err ? <span className="ml-1 font-medium text-[var(--color-bad)]">{err}</span> : null}
      </div>
      <button
        type="button"
        onClick={share}
        disabled={pending || (unshared === 0 && done != null)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : unshared === 0 ? <Check className="size-4" /> : <Send className="size-4" />}
        {unshared === 0 ? "Gedeeld" : "Goedkeuren en delen met klant"}
      </button>
    </div>
  );
}
