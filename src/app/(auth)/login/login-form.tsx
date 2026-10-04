"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "@/server/auth/actions";
import { Button, ErrorNote } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
      {pending ? "Bezig met inloggen…" : "Inloggen"}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

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

      <SubmitButton />
    </form>
  );
}
