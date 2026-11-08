"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2, Play } from "lucide-react";
import { adjustPlanningDeadline, completePlanningDeadline, startPlanningDeadline } from "@/server/actions/planning-deadlines";

/** Deadline aanpassen (met reden) of handmatig afronden, vanuit het interne overzicht. */
export function DeadlineRowActions({ clientId, clientName, deadlineOn }: { clientId: string; clientName: string; deadlineOn: string }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(deadlineOn);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { setEditing(false); setReason(""); router.refresh(); }
      else setErr(res.message ?? "Mislukt.");
    });
  }

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center justify-end gap-1.5"
        onSubmit={(e) => { e.preventDefault(); run(() => adjustPlanningDeadline(clientId, date, reason)); }}
      >
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 text-xs" aria-label={`Nieuwe deadline ${clientName}`} required />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reden" className="h-8 w-40 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 text-xs" aria-label="Reden van de wijziging" required />
        <button type="submit" disabled={pending} className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-2.5 text-xs font-semibold text-white disabled:opacity-60">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
        </button>
        <button type="button" onClick={() => { setEditing(false); setErr(null); setDate(deadlineOn); }} className="h-8 px-2 text-xs text-[var(--color-ink-muted)] hover:underline">Annuleren</button>
        {err ? <span className="w-full text-right text-xs text-[var(--color-bad)]">{err}</span> : null}
      </form>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button type="button" onClick={() => setEditing(true)} className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]">
        <CalendarClock className="size-3.5" /> Aanpassen
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => { if (window.confirm(`Deadline van ${clientName} op Afgerond zetten?`)) run(() => completePlanningDeadline(clientId)); }}
        className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)] disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Afronden
      </button>
      {err ? <span className="text-xs text-[var(--color-bad)]">{err}</span> : null}
    </div>
  );
}

/** Afteller starten voor een klant waarvan de planning al eerder gedeeld was. */
export function StartDeadlineButton({ clientId }: { clientId: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await startPlanningDeadline(clientId); if (r.ok) router.refresh(); else setErr(r.message ?? "Mislukt."); })}
        className="sc-card inline-flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Start deadline van 21 dagen
      </button>
      {err ? <span className="text-xs text-[var(--color-bad)]">{err}</span> : null}
    </span>
  );
}
