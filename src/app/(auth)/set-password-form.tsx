"use client";

import { useState, useTransition } from "react";
import { Loader2, Lock } from "lucide-react";
import { completePortalSetup } from "@/server/actions/portal-accounts";

/**
 * Gedeeld formulier waarmee een klant zelf een wachtwoord instelt — zowel bij een
 * uitnodiging als bij een wachtwoordherstel. Bij succes logt de serveractie de
 * klant meteen in en stuurt door naar het portaal (redirect), dus hier hoeven we
 * alleen fouten te tonen.
 */
export function SetPasswordForm({ token, purpose }: { token: string; purpose: "invite" | "reset" }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 10) { setErr("Kies een wachtwoord van minstens 10 tekens."); return; }
    if (pw !== confirm) { setErr("De twee wachtwoorden zijn niet gelijk."); return; }
    startTransition(async () => {
      try {
        const r = await completePortalSetup({ token, password: pw });
        // Bij succes redirect de actie; komen we hier, dan is er een melding.
        if (r && !r.ok) setErr(r.message);
      } catch (e) {
        // NEXT_REDIRECT wordt door Next afgehandeld; andere fouten tonen we.
        if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) return;
        setErr("Er ging iets mis. Probeer het later opnieuw.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Nieuw wachtwoord</span>
        <input
          type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required
          placeholder="Minstens 10 tekens"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-brand-500)]"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Herhaal wachtwoord</span>
        <input
          type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-brand-500)]"
        />
      </label>

      {err ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[var(--color-bad)]">{err}</p> : null}

      <button type="submit" disabled={pending} className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
        {purpose === "invite" ? "Wachtwoord instellen & inloggen" : "Wachtwoord opslaan & inloggen"}
      </button>
    </form>
  );
}
