"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { downloadFrom } from "@/lib/save-file";

/**
 * "Download contentplanning als PDF". Haalt de PDF op bij de opgegeven route
 * (klant of team, beide via dezelfde centrale generator) en start de download.
 * Toont een laadstatus, want het opmaken duurt een paar seconden.
 */
export function ContentPlanningPdfButton({ href, label = "Download contentplanning als PDF", className = "" }: { href: string; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setErr(null);
    try {
      await downloadFrom(href, "Shortclips_Contentplanning.pdf");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Downloaden is niet gelukt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className={`inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border border-[var(--sc-line,var(--color-line))] bg-[var(--color-surface)] px-3.5 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--sc-fill,var(--color-surface-sunken))] disabled:opacity-70 ${className}`}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {busy ? "PDF wordt gemaakt…" : label}
      </button>
      {err ? <span className="text-[12px] text-[var(--st-red,var(--color-bad))]">{err}</span> : null}
    </span>
  );
}
