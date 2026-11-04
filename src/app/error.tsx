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
    // Automatisch herstel bij een versie-mismatch: na een nieuwe deploy heeft de
    // browser soms nog oude JS-chunks in cache, terwijl de server nieuwe HTML
    // stuurt → een hydratie-/chunkfout (React #418–#425/#441, ChunkLoadError).
    // Dat is geen echte bug; één keer vers laden haalt de juiste chunks op. We
    // herladen hooguit één keer per 20s (sessie-guard) zodat er nooit een
    // herlaad-loop ontstaat bij een écht hardnekkige fout.
    if (typeof window === "undefined") return;
    const msg = `${error?.message ?? ""} ${error?.name ?? ""}`;
    const looksLikeVersionSkew =
      /Minified React error #(418|419|420|421|422|423|424|425|441)\b/i.test(msg) ||
      /ChunkLoadError|Loading chunk \S+ failed|dynamically imported module|importing a module script failed|hydrat/i.test(msg);
    if (!looksLikeVersionSkew) return;
    try {
      // Hooguit ÉÉN automatische herlaad per sessie — zo kan er nooit een
      // herlaad-lus ontstaan als de fout toch terugkomt (dan tonen we gewoon de
      // foutpagina en stopt het).
      const KEY = "sc_skew_reloaded";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    } catch { /* opslag geblokkeerd → gewoon de foutpagina tonen */ }
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
