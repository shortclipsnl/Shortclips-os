"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { getMyAgendaFeed, regenerateMyAgendaFeed } from "@/server/actions/editor-calendar";

/**
 * "Koppel mijn agenda": toont de persoonlijke iCal-abonnementslink waarmee de
 * editor al zijn toegewezen video's + deadlines automatisch in Google Agenda
 * krijgt. De link wordt pas aangemaakt bij de eerste klik (lui), en kan opnieuw
 * worden gegenereerd om de oude in te trekken.
 */
export function AgendaConnect() {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function connect() {
    setOpen(true);
    if (url) return;
    start(async () => {
      try { const r = await getMyAgendaFeed(); setUrl(r.url); } catch { /* stil */ }
    });
  }
  function regenerate() {
    start(async () => {
      try { const r = await regenerateMyAgendaFeed(); setUrl(r.url); setCopied(false); } catch { /* stil */ }
    });
  }
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* geblokkeerd */ }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={connect}
        className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3.5 py-2 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"
      >
        <CalendarPlus className="size-4 text-[var(--color-brand-600)]" /> Koppel mijn agenda
      </button>
    );
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-2">
        <CalendarPlus className="size-4 text-[var(--color-brand-600)]" />
        <span className="text-sm font-semibold">Jouw projecten in Google Agenda</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Sluiten</button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">
        Abonneer je Google Agenda op deze persoonlijke link. Al je toegewezen video&apos;s en
        deadlines verschijnen dan automatisch — nieuwe toewijzingen en wijzigingen komen er
        vanzelf bij. Je hoeft dit maar één keer te doen.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={pending && !url ? "Link aanmaken…" : (url ?? "")}
          onFocus={(e) => e.currentTarget.select()}
          className="sc-input h-10 min-w-56 flex-1 font-mono text-xs"
        />
        <button type="button" onClick={copy} disabled={!url || pending}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3.5 text-sm font-semibold text-white hover:bg-[var(--color-brand-600)] disabled:opacity-50">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Gekopieerd" : "Kopieer link"}
        </button>
      </div>

      <ol className="mt-3 list-decimal space-y-0.5 pl-4 text-xs text-[var(--color-ink-muted)]">
        <li>Open Google Agenda → links bij <strong>Andere agenda&apos;s</strong> op <strong>+</strong> → <strong>Via URL</strong>.</li>
        <li>Plak de gekopieerde link en klik op <strong>Agenda toevoegen</strong>.</li>
        <li>Klaar — je deadlines staan er als hele-dag-markering, en blijven automatisch up-to-date.</li>
      </ol>

      <button type="button" onClick={regenerate} disabled={pending}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Nieuwe link maken (trekt de oude in)
      </button>
    </div>
  );
}
