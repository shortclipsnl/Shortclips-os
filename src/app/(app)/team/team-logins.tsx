"use client";

import { useState } from "react";
import { Copy, KeyRound, Loader2, Check } from "lucide-react";

type Credential = { fullName: string; role: string; email: string; password: string };
type Result = { ok: boolean; created: number; alreadyHadLogin: number; credentials: Credential[] };

/**
 * Eigenaar-knop: geeft teamleden zónder login een persoonlijk wachtwoord en toont
 * de inloggegevens eenmalig, zodat de eigenaar ze kan doorgeven. Bestaande logins
 * blijven ongemoeid. Deze gegevens zijn daarna niet meer op te vragen.
 */
export function TeamLogins() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team-logins", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Er ging iets mis.");
        return;
      }
      setResult(data as Result);
    } catch {
      setError("Kon de inloggegevens niet aanmaken. Probeer het later opnieuw.");
    } finally {
      setPending(false);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // Klembord geweigerd — de gebruiker kan de tekst nog steeds selecteren.
    }
  }

  return (
    <div className="mb-6 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
            <KeyRound className="size-4 text-[var(--color-brand-600)]" /> Inloggegevens voor het team
          </h2>
          <p className="mt-0.5 max-w-prose text-xs text-[var(--color-ink-muted)]">
            Geeft iedereen zónder login een persoonlijk wachtwoord voor het interne dashboard. Bestaande logins blijven
            ongewijzigd. Je ziet de nieuwe wachtwoorden hier <strong>één keer</strong> — geef ze daarna direct door.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-indigo-soft)] disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
          Inloggegevens aanmaken
        </button>
      </div>

      {error ? <p className="mt-3 text-xs font-medium text-[var(--color-bad)]">{error}</p> : null}

      {result ? (
        <div className="mt-4">
          <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
            {result.created > 0
              ? `${result.created} nieuwe login(s) aangemaakt · ${result.alreadyHadLogin} had al een login.`
              : `Iedereen had al een login (${result.alreadyHadLogin}). Er is niets gewijzigd.`}
          </p>
          {result.credentials.length > 0 ? (
            <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
              {result.credentials.map((c) => (
                <li key={c.email} className="flex flex-wrap items-center justify-between gap-2 bg-[var(--color-surface)] px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{c.fullName}</span>
                    <span className="ml-2 text-xs text-[var(--color-ink-muted)]">{c.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="select-all rounded bg-[var(--color-surface-sunken)] px-2 py-1 text-xs font-semibold tabular-nums">{c.password}</code>
                    <button
                      type="button"
                      onClick={() => copy(`${c.email}  ${c.password}`, c.email)}
                      title="E-mail en wachtwoord kopiëren"
                      className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                      {copied === c.email ? <Check className="size-3.5 text-[var(--color-good)]" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
