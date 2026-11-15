"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { PortalDownloadButton } from "@/components/portal/download-button";
import { PeriodSwitch } from "@/components/period-switch";
import type { PeriodMode, PeriodOption } from "@/lib/portal-periods";

/**
 * Bovenkant van de resultatenpagina: Maandelijks | Per kwartaal met de
 * periodekeuze, en rechts het rapport downloaden of delen.
 */
export function ResultControls({
  basePath,
  mode,
  periodKey,
  months,
  quarters,
  from,
  to,
  download,
  shareHref,
}: {
  basePath: string;
  mode: PeriodMode;
  periodKey: string;
  months: PeriodOption[];
  quarters: PeriodOption[];
  from?: string;
  to?: string;
  /** PDF van de gekozen periode. */
  download: { href: string; label: string; filename: string };
  /** Link naar het rapport op het scherm (om te delen). */
  shareHref: string;
}) {
  const [copied, setCopied] = useState(false);

  // Rapport doorsturen/delen: op mobiel het OS-deelvenster (mail, WhatsApp, …),
  // op desktop een terugval die de link naar het rapport kopieert.
  async function shareReport() {
    const url = typeof window !== "undefined" ? new URL(shareHref, window.location.origin).href : shareHref;
    const data = { title: "Shortclips, jouw resultaten", text: "Bekijk de Shortclips-resultaten", url };
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch {
      /* gebruiker annuleerde of delen niet beschikbaar → kopieer-terugval */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* geen clipboard beschikbaar */
    }
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <PeriodSwitch basePath={basePath} mode={mode} periodKey={periodKey} months={months} quarters={quarters} from={from} to={to} />
      <div className="inline-flex shrink-0 flex-wrap items-center gap-2">
        <PortalDownloadButton
          href={download.href}
          filename={download.filename}
          label={download.label}
          busyLabel="Rapport wordt gemaakt…"
          className="sc-btn-cta inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-70"
        />
        <button
          type="button"
          onClick={shareReport}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] px-4 py-2 text-[13px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--sc-fill-strong)]"
        >
          {copied ? <><Check className="size-4 text-[var(--st-green)]" /> Link gekopieerd</> : <><Share2 className="size-4" /> Delen</>}
        </button>
      </div>
    </div>
  );
}
