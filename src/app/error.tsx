"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Vangnet voor onverwachte fouten. De gebruiker krijgt een begrijpelijke tekst;
 * de technische details gaan naar de console en (server-side) naar error_logs.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[shortclips-os]", error);
  }, [error]);

  const isForbidden = error.message.includes("geen toegang") || error.name === "ForbiddenError";

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <AlertTriangle
          className="mx-auto size-10 text-[var(--color-warn)]"
          strokeWidth={1.5}
        />
        <h1 className="mt-4 text-lg font-semibold">
          {isForbidden ? "Geen toegang" : "Er ging iets mis"}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          {isForbidden
            ? error.message
            : "We konden dit scherm niet laden. Probeer het opnieuw; blijft het misgaan, meld het dan bij een beheerder."}
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-2xs text-[var(--color-ink-faint)]">
            Referentie: {error.digest}
          </p>
        ) : null}
        {!isForbidden ? (
          <button
            onClick={reset}
            className="mt-5 inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 text-sm font-medium text-white hover:bg-[var(--color-indigo-soft)]"
          >
            Opnieuw proberen
          </button>
        ) : null}
      </div>
    </div>
  );
}
