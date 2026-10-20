"use client";

import { useState } from "react";
import { Copy, KeyRound, Loader2, Check, RotateCcw } from "lucide-react";

type Credential = { fullName: string; role: string; email: string; password: string };
type Result = { ok: boolean; created: number; alreadyHadLogin: number; credentials: Credential[] };
type Member = { id: string; fullName: string; email: string; role: string };

const ROLE_LABELS: Record<string, string> = {
  owner: "Eigenaar",
  admin: "Beheerder",
  project_coordinator: "Projectcoördinator",
  content_creator: "Content creator",
  videographer: "Videograaf",
  editor: "Editor",
  finance: "Finance",
};

/**
 * Eigenaar-blok: logins voor het team beheren. "Inloggegevens aanmaken" geeft
 * iedereen zónder login een wachtwoord. Daaronder kun je per teamlid een nieuw
 * wachtwoord instellen — nodig als een bestaand wachtwoord nooit is doorgegeven
 * (het oude is versleuteld en niet meer op te halen). Wachtwoorden worden
 * éénmalig getoond.
 */
export function TeamLogins({ members }: { members: Member[] }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Per-persoon reset.
  const [showReset, setShowReset] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetCreds, setResetCreds] = useState<Record<string, Credential>>({});
  const [resetError, setResetError] = useState<string | null>(null);

  async function createMissing() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team-logins", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "Er ging iets mis."); return; }
      setResult(data as Result);
    } catch {
      setError("Kon de inloggegevens niet aanmaken. Probeer het later opnieuw.");
    } finally {
      setPending(false);
    }
  }

  async function resetOne(userId: string) {
    setResetting(userId);
    setResetError(null);
    try {
      const res = await fetch("/api/admin/team-logins/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) { setResetError(data?.error ?? "Mislukt."); return; }
      setResetCreds((c) => ({ ...c, [userId]: data as Credential }));
    } catch {
      setResetError("Kon het wachtwoord niet opnieuw instellen.");
    } finally {
      setResetting(null);
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

  const CredLine = ({ c, k }: { c: Credential; k: string }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--color-surface)] px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{c.fullName}</span>
        <span className="ml-2 text-xs text-[var(--color-ink-muted)]">{c.email}</span>
      </div>
      <div className="flex items-center gap-2">
        <code className="select-all rounded bg-[var(--color-surface-sunken)] px-2 py-1 text-xs font-semibold tabular-nums">{c.password}</code>
        <button type="button" onClick={() => copy(`${c.email}  ${c.password}`, k)} title="E-mail en wachtwoord kopiëren"
          className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
          {copied === k ? <Check className="size-3.5 text-[var(--color-good)]" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mb-6 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
            <KeyRound className="size-4 text-[var(--color-brand-600)]" /> Inloggegevens voor het team
          </h2>
          <p className="mt-0.5 max-w-prose text-xs text-[var(--color-ink-muted)]">
            Geeft iedereen zónder login een persoonlijk wachtwoord. Bestaande logins blijven ongewijzigd. Je ziet nieuwe
            wachtwoorden hier <strong>één keer</strong> — geef ze daarna direct door.
          </p>
        </div>
        <button type="button" onClick={createMissing} disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-indigo-soft)] disabled:opacity-60">
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
              : `Iedereen had al een login (${result.alreadyHadLogin}). Er is niets gewijzigd — gebruik hieronder "nieuw wachtwoord" als iemand zijn login kwijt is.`}
          </p>
          {result.credentials.length > 0 ? (
            <div className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
              {result.credentials.map((c) => <CredLine key={c.email} c={c} k={`new:${c.email}`} />)}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Per-persoon: nieuw wachtwoord instellen (voor wie zijn login kwijt is). */}
      <div className="mt-4 border-t border-[var(--color-line)] pt-3">
        <button type="button" onClick={() => setShowReset((s) => !s)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-600)] hover:underline">
          <RotateCcw className="size-3.5" /> {showReset ? "Verberg" : "Nieuw wachtwoord instellen voor iemand"}
        </button>
        {resetError ? <p className="mt-2 text-xs font-medium text-[var(--color-bad)]">{resetError}</p> : null}
        {showReset ? (
          <ul className="mt-2 divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
            {members.map((m) => {
              const cred = resetCreds[m.id];
              return (
                <li key={m.id} className="bg-[var(--color-surface)] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{m.fullName}</span>
                      <span className="ml-2 text-xs text-[var(--color-ink-muted)]">{m.email} · {ROLE_LABELS[m.role] ?? m.role}</span>
                    </div>
                    {cred ? (
                      <div className="flex items-center gap-2">
                        <code className="select-all rounded bg-[var(--color-surface-sunken)] px-2 py-1 text-xs font-semibold tabular-nums">{cred.password}</code>
                        <button type="button" onClick={() => copy(`${cred.email}  ${cred.password}`, `reset:${m.id}`)} title="E-mail en wachtwoord kopiëren"
                          className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
                          {copied === `reset:${m.id}` ? <Check className="size-3.5 text-[var(--color-good)]" /> : <Copy className="size-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => resetOne(m.id)} disabled={resetting === m.id}
                        className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-60">
                        {resetting === m.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Nieuw wachtwoord
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
