"use client";

import { useEffect } from "react";

/**
 * Laatste vangnet: vangt fouten die zó vroeg optreden dat zelfs de root-layout
 * niet rendert. Moet daarom een compleet document (<html>/<body>) teruggeven en
 * mag niet op de app-stijlen leunen — vandaar inline styles in de huisstijl.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[shortclips-os] global", error);
    // Zie error.tsx: automatisch vers herladen bij een versie-mismatch (oude
    // chunks na een nieuwe deploy), met een sessie-guard tegen herlaad-loops.
    if (typeof window === "undefined") return;
    const msg = `${error?.message ?? ""} ${error?.name ?? ""}`;
    const looksLikeVersionSkew =
      /Minified React error #(418|419|420|421|422|423|424|425|441)\b/i.test(msg) ||
      /ChunkLoadError|Loading chunk \S+ failed|dynamically imported module|importing a module script failed|hydrat/i.test(msg);
    if (!looksLikeVersionSkew) return;
    try {
      // Hooguit ÉÉN automatische herlaad per sessie (geen herlaad-lus).
      const KEY = "sc_skew_reloaded";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    } catch { /* opslag geblokkeerd → gewoon de foutpagina tonen */ }
  }, [error]);

  return (
    <html lang="nl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#00003b",
          color: "#ffffff",
          fontFamily: "Inter, Segoe UI, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "420px", textAlign: "center" }}>
          <div style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            ShortClips
          </div>
          <h1 style={{ margin: "20px 0 8px", fontSize: "18px", fontWeight: 600 }}>
            Er ging iets mis
          </h1>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: "#c7d2e4" }}>
            We konden de pagina even niet laden. Probeer het opnieuw; blijft het
            misgaan, neem dan contact op met ShortClips.
          </p>
          {error.digest ? (
            <p style={{ marginTop: "12px", fontSize: "12px", color: "#7f93b3", fontFamily: "monospace" }}>
              Referentie: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: "20px",
              background: "#FF6A00",
              color: "#ffffff",
              border: "none",
              borderRadius: "10px",
              padding: "11px 22px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Opnieuw proberen
          </button>
        </div>
      </body>
    </html>
  );
}
