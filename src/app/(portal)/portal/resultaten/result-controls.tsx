"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PortalDownloadButton } from "@/components/portal/download-button";
import { CalendarRange, Check, Loader2, Share2 } from "lucide-react";
import { PORTAL_MONTH_PERIODS, PORTAL_PERIODS } from "@/lib/portal-periods";

/**
 * Periodekeuze + PDF-download voor de resultatenpagina. Wisselt de periode via
 * een zachte navigatie (query-param) zodat de cijfers serverzijdig vers blijven
 * en overal (dashboard, grafiek, video's) tegelijk meebewegen.
 */
export function ResultControls({
  basePath,
  periodKey,
  from,
  to,
  reportHref,
}: {
  basePath: string;
  periodKey: string;
  from?: string;
  to?: string;
  reportHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [van, setVan] = useState(from ?? "");
  const [tot, setTot] = useState(to ?? "");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  // Periode wisselen: navigeer naar de nieuwe query én forceer een verse
  // serverophaling. router.refresh() voorkomt dat de client-routercache dezelfde
  // (oude) cijfers blijft tonen bij een wijziging van alleen de query-parameters.
  const go = (q: string) =>
    startTransition(() => {
      // Gekozen platform behouden bij het wisselen van periode.
      let extra = "";
      try {
        const plat = new URL(window.location.href).searchParams.get("platform");
        if (plat && /^[a-z]+$/.test(plat)) extra = `&platform=${plat}`;
      } catch {
        /* geen URL: alleen de periode */
      }
      router.push(`${basePath}?${q}${extra}`);
      router.refresh();
    });
  const applyCustom = () => {
    if (van && tot && van <= tot) {
      setOpen(false);
      go(`periode=custom&van=${van}&tot=${tot}`);
    }
  };

  // Rapport doorsturen/delen: op mobiel het OS-deelvenster (mail, WhatsApp, …),
  // op desktop een terugval die de link naar het rapport kopieert.
  async function shareReport() {
    const url = typeof window !== "undefined" ? new URL(reportHref, window.location.origin).href : reportHref;
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
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
      <div aria-busy={pending} className={`inline-flex flex-wrap items-center gap-1 rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] p-1 transition-opacity ${pending ? "opacity-60" : ""}`}>
        {[...PORTAL_MONTH_PERIODS, ...PORTAL_PERIODS].map((p) => {
          const active = p.key === periodKey;
          return (
            <button
              key={p.key}
              type="button"
              disabled={pending}
              onClick={() => go(`periode=${p.key}`)}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-wait ${active ? "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
            >
              {active && pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${periodKey === "custom" ? "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
        >
          <CalendarRange className="size-3.5" /> Eigen periode
        </button>
      </div>

      <div className="inline-flex shrink-0 items-center gap-2">
        <PortalDownloadButton
          href={reportHref}
          filename="Shortclips_Resultaten.pdf"
          label="Download rapport"
          busyLabel="Rapport wordt gemaakt…"
          className="sc-btn-cta inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-70"
        />
        <button
          type="button"
          onClick={shareReport}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] px-4 py-1.5 text-[13px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--sc-fill-strong)]"
        >
          {copied ? <><Check className="size-4 text-[var(--st-green)]" /> Link gekopieerd</> : <><Share2 className="size-4" /> Delen</>}
        </button>
      </div>

      {open ? (
        <div className="flex flex-wrap items-end gap-2 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-inset)] p-3 sm:absolute sm:right-0 sm:top-full sm:z-10 sm:mt-2 sm:shadow-xl">
          <label className="flex flex-col gap-1 text-[11px] text-[var(--color-ink-muted)]">
            Van
            <input type="date" value={van} max={tot || undefined} onChange={(e) => setVan(e.target.value)} className="sc-input rounded-lg px-2.5 py-1.5 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--color-ink-muted)]">
            Tot
            <input type="date" value={tot} min={van || undefined} onChange={(e) => setTot(e.target.value)} className="sc-input rounded-lg px-2.5 py-1.5 text-[13px]" />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!van || !tot || van > tot || pending}
            className="sc-btn-cta inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-40"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Toepassen
          </button>
        </div>
      ) : null}
    </div>
  );
}
