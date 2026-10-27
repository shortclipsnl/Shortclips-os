"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Lock } from "lucide-react";
import { changeOwnPassword } from "@/server/auth/actions";
import { Card, CardHeader } from "@/components/ui";

/** Self-service wachtwoord wijzigen voor de ingelogde gebruiker (team én klant). */
export function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setDone(false);
    if (next.length < 10) { setErr("Kies een wachtwoord van minstens 10 tekens."); return; }
    if (next !== confirm) { setErr("De twee nieuwe wachtwoorden zijn niet gelijk."); return; }
    startTransition(async () => {
      try {
        const r = await changeOwnPassword({ current, next });
        if (r.ok) { setDone(true); setCurrent(""); setNext(""); setConfirm(""); }
        else setErr(r.message ?? "Er ging iets mis.");
      } catch { setErr("Wijzigen mislukt. Probeer het later opnieuw."); }
    });
  }

  return (
    <Card>
      <CardHeader title="Wachtwoord wijzigen" subtitle="Andere apparaten worden na het wijzigen uitgelogd." />
      <form onSubmit={submit} className="mt-3 max-w-[360px] space-y-3">
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required placeholder="Huidig wachtwoord"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-500)]" />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required placeholder="Nieuw wachtwoord (min. 10 tekens)"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-500)]" />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required placeholder="Herhaal nieuw wachtwoord"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-500)]" />
        {err ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[var(--color-bad)]">{err}</p> : null}
        {done ? <p className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-good-soft)] px-3 py-2 text-sm text-[#1d6b4c]"><Check className="size-4" /> Wachtwoord gewijzigd.</p> : null}
        <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />} Wachtwoord wijzigen
        </button>
      </form>
    </Card>
  );
}
