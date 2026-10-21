"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, RotateCcw } from "lucide-react";
import { setClientPortalLogin, type PortalLoginResult } from "@/server/actions/clients";
import { Card } from "@/components/ui";

/**
 * Portaaltoegang van een klant beheren (alleen eigenaar). Hier geef je een klant
 * een login of een nieuw wachtwoord. Het wachtwoord zie je hier één keer — daarna
 * staat het alleen versleuteld opgeslagen en kan niemand het meer inzien.
 */
export function ClientPortalLogin({
  clientId,
  hasLogin,
  loginEmail,
}: {
  clientId: string;
  hasLogin: boolean;
  loginEmail: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PortalLoginResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await setClientPortalLogin(clientId);
      if (res.ok) setResult(res);
      else setError(res.message ?? "Er ging iets mis.");
    } catch {
      setError("Kon de login niet instellen. Probeer het later opnieuw.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!result?.email || !result.password) return;
    try {
      await navigator.clipboard.writeText(`${result.email}  ${result.password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* kopiëren niet beschikbaar */
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--color-ink)]">
            <KeyRound className="size-4 text-[var(--color-brand-600)]" /> Portaaltoegang
          </h3>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {hasLogin ? (
              <>Deze klant heeft een login{loginEmail ? <> — <strong className="text-[var(--color-ink)]">{loginEmail}</strong></> : ""}. Wachtwoord vergeten? Stel een nieuw in.</>
            ) : (
              <>Nog geen login. Maak er een aan, zodat de klant in het portaal kan. Het e-mailadres komt uit de contactpersoon van de klant.</>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : hasLogin ? <RotateCcw className="size-4" /> : <KeyRound className="size-4" />}
          {hasLogin ? "Nieuw wachtwoord" : "Inloggegevens aanmaken"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[var(--color-bad)]">{error}</p>
      ) : null}

      {result?.ok && result.password ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-good)]/30 bg-[var(--color-good-soft)]/50 p-3">
          <div className="text-xs font-semibold text-[#1d6b4c]">
            Login {result.action}. Geef deze gegevens direct door — je ziet het wachtwoord hier <strong>maar één keer</strong>.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-[var(--color-surface)] px-2 py-1 text-sm ring-1 ring-[var(--color-line)]">{result.email}</code>
            <code className="rounded bg-[var(--color-surface)] px-2 py-1 text-sm font-semibold ring-1 ring-[var(--color-line)]">{result.password}</code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-ink)] ring-1 ring-[var(--color-line)] hover:brightness-95"
            >
              {copied ? <><Check className="size-3.5 text-[var(--color-good)]" /> Gekopieerd</> : <><Copy className="size-3.5" /> Kopieer</>}
            </button>
          </div>
          <p className="mt-2 text-2xs text-[var(--color-ink-muted)]">Inloggen doet de klant op de inlogpagina met dit e-mailadres en wachtwoord.</p>
        </div>
      ) : null}
    </Card>
  );
}
