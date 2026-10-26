"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarRange, Download } from "lucide-react";
import { PORTAL_PERIODS } from "@/lib/portal-periods";

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

  const go = (q: string) => router.push(`${basePath}?${q}`);
  const applyCustom = () => {
    if (van && tot && van <= tot) go(`periode=custom&van=${van}&tot=${tot}`);
  };

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
      <div className="inline-flex flex-wrap gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
        {PORTAL_PERIODS.map((p) => {
          const active = p.key === periodKey;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => go(`periode=${p.key}`)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${active ? "bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${periodKey === "custom" ? "bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
        >
          <CalendarRange className="size-3.5" /> Eigen periode
        </button>
      </div>

      <a
        href={reportHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-[#0a0c26] transition-opacity hover:opacity-90"
      >
        <Download className="size-4" /> Download rapport
      </a>

      {open ? (
        <div className="flex flex-wrap items-end gap-2 rounded-[14px] border border-white/10 bg-[rgba(10,12,38,0.6)] p-3 sm:absolute sm:right-0 sm:top-full sm:z-10 sm:mt-2 sm:shadow-xl">
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
            disabled={!van || !tot || van > tot}
            className="rounded-lg bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            Toepassen
          </button>
        </div>
      ) : null}
    </div>
  );
}
