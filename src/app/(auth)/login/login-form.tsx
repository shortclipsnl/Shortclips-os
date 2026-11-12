"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, verifyLoginCodeAction, type LoginState } from "@/server/auth/actions";
import { Button, ErrorNote } from "@/components/ui";
import { PasskeyLoginButton } from "@/components/portal-app/passkey";

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

/** Tweede stap: de code uit de e-mail (alleen voor klanten waar dit aanstaat). */
function CodeForm({ maskedEmail }: { maskedEmail?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(verifyLoginCodeAction, { step: "code" });

  // Code verlopen of te vaak fout: terug naar wachtwoord.
  if (state.step !== "code") {
    return (
      <div className="mt-6 space-y-4">
        {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
        <Button type="button" size="lg" className="w-full" onClick={() => window.location.reload()}>
          Opnieuw inloggen
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <p className="text-sm text-[var(--color-ink-muted)]">
        We hebben een inlogcode van 6 cijfers gestuurd naar <strong className="text-[var(--color-ink)]">{maskedEmail ?? "je e-mailadres"}</strong>.
        Op dit apparaat vragen we hem daarna niet meer.
      </p>
      <div>
        <label className="sc-label" htmlFor="code">
          Inlogcode
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
          className="sc-input text-center text-lg tracking-[0.4em]"
          placeholder="000000"
        />
      </div>

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <SubmitButton idle="Bevestigen" busy="Bezig met controleren…" />
      <p className="text-xs text-[var(--color-ink-faint)]">
        Geen e-mail ontvangen? Kijk ook in je spam, of log opnieuw in voor een nieuwe code.
      </p>
    </form>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  if (state.step === "code") return <CodeForm maskedEmail={state.maskedEmail} />;

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div>
        <label className="sc-label" htmlFor="email">
          E-mailadres
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="sc-input"
          placeholder="naam@shortclips.nl"
        />
      </div>

      <div>
        <label className="sc-label" htmlFor="password">
          Wachtwoord
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="sc-input"
          placeholder="••••••••"
        />
      </div>

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <SubmitButton idle="Inloggen" busy="Bezig met inloggen…" />
      <PasskeyLoginButton />
    </form>
  );
}
