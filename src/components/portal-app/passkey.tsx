"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, ScanFace, Trash2 } from "lucide-react";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import {
  finishPasskeyLogin,
  finishPasskeyRegistration,
  removeMyPasskey,
  startPasskeyLogin,
  startPasskeyRegistration,
  type PasskeyRow,
} from "@/server/auth/passkeys";
import { Button, ErrorNote } from "@/components/ui";

/** iPhone/iPad/Mac noemen het Face ID of Touch ID; de rest "vingerafdruk of gezicht". */
function biometricLabel(): { label: string; Icon: typeof ScanFace } {
  if (typeof navigator === "undefined") return { label: "Face ID of Touch ID", Icon: ScanFace };
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return { label: "Face ID", Icon: ScanFace };
  if (/Macintosh/i.test(ua)) return { label: "Touch ID", Icon: Fingerprint };
  if (/Android/i.test(ua)) return { label: "vingerafdruk of gezicht", Icon: Fingerprint };
  return { label: "Face ID of Touch ID", Icon: ScanFace };
}

/** Annuleren door de gebruiker is geen fout om te tonen. */
function isCancel(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

const noopSubscribe = () => () => {};

function useSupported() {
  return useSyncExternalStore(noopSubscribe, () => browserSupportsWebAuthn(), () => false);
}

const SERVER_LABEL = { label: "Face ID of Touch ID", Icon: ScanFace };
let cachedLabel: ReturnType<typeof biometricLabel> | null = null;
function useBiometricLabel() {
  return useSyncExternalStore(
    noopSubscribe,
    () => (cachedLabel ??= biometricLabel()),
    () => SERVER_LABEL,
  );
}

/** Knop op het inlogscherm. */
export function PasskeyLoginButton() {
  const supported = useSupported();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { label, Icon } = useBiometricLabel();

  if (!supported) return null;

  async function go() {
    setError(null);
    setBusy(true);
    try {
      const { challengeId, options } = await startPasskeyLogin();
      const response = await startAuthentication({ optionsJSON: options });
      const result = await finishPasskeyLogin({ challengeId, response });
      if (result.ok) {
        window.location.assign(result.target);
        return;
      }
      setError(result.message);
    } catch (e) {
      if (!isCancel(e)) setError("Inloggen met " + label + " is niet gelukt. Log in met je wachtwoord.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-3 text-xs text-[var(--color-ink-faint)]">
        <span className="h-px flex-1 bg-[var(--sc-line)]" />
        of
        <span className="h-px flex-1 bg-[var(--sc-line)]" />
      </div>
      <Button type="button" variant="secondary" size="lg" className="w-full" onClick={go} disabled={busy}>
        <Icon className="size-5" strokeWidth={1.8} />
        {busy ? "Even geduld…" : `Inloggen met ${label}`}
      </Button>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}

/** Beheer op Mijn account: koppelen en verwijderen. */
export function PasskeyManager({ initial }: { initial: PasskeyRow[] }) {
  const supported = useSupported();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const { label, Icon } = useBiometricLabel();

  async function add() {
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      const begin = await startPasskeyRegistration();
      if (!begin.ok) {
        setError(begin.message);
        return;
      }
      const response = await startRegistration({ optionsJSON: begin.options });
      const result = await finishPasskeyRegistration({ challengeId: begin.challengeId, response });
      if (!result.ok) {
        setError(result.message ?? "Koppelen is niet gelukt.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "InvalidStateError") setError("Dit apparaat is al gekoppeld.");
      else if (!isCancel(e)) setError("Koppelen is niet gelukt. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {initial.length > 0 ? (
        <ul className="divide-y divide-[var(--sc-line)] rounded-xl border border-[var(--sc-line)]">
          {initial.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <Fingerprint className="size-5 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-ink)]">{p.deviceName ?? "Apparaat"}</p>
                <p className="text-xs text-[var(--color-ink-faint)]">
                  Gekoppeld op {new Date(p.createdAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}
                  {p.lastUsedAt ? ` · laatst gebruikt ${new Date(p.lastUsedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="Verwijderen"
                disabled={pending}
                onClick={() => start(async () => { await removeMyPasskey(p.id); router.refresh(); })}
                className="inline-flex size-10 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--sc-fill)] hover:text-[var(--color-bad)]"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {supported ? (
        <Button type="button" onClick={add} disabled={busy} className="w-full sm:w-auto">
          <Icon className="size-4" strokeWidth={1.9} />
          {busy ? "Even geduld…" : `${label} op dit apparaat aanzetten`}
        </Button>
      ) : (
        <p className="text-sm text-[var(--color-ink-muted)]">Dit apparaat of deze browser ondersteunt inloggen zonder wachtwoord niet.</p>
      )}
      {done ? <p className="text-sm text-[var(--color-good)]">Gelukt. Je kunt voortaan inloggen met {label}.</p> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}
