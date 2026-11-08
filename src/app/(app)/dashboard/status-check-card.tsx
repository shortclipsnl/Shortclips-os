"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { submitEditorStatus } from "@/server/actions/editor-status";
import { EDITOR_PROGRESS_OPTIONS, type EditorProgressStatus } from "@/lib/editor-status-check";
import type { OpenStatusCheck } from "@/server/editor-status-checks";

function fmtDeadline(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/**
 * Statuscheck bovenaan Vandaag in het editorportaal. Eén klik op een status
 * slaat hem direct op; de toelichting is optioneel en mag leeg blijven.
 * Beantwoorde checks blijven zichtbaar als bevestiging tot de pagina opnieuw
 * laadt, zodat de editor ziet dat het gelukt is (en kan wijzigen).
 */
export function StatusCheckCards({ checks }: { checks: OpenStatusCheck[] }) {
  // Lokale kopie: na een antwoord ververst de server de pagina en valt de check
  // uit de props, maar de bevestiging moet nog even te zien zijn.
  const [items] = useState(checks);
  if (items.length === 0) return null;
  return (
    <div id="statuscheck" className="scroll-mt-20 space-y-3">
      {items.map((c) => <StatusCheckCard key={c.id} check={c} />)}
    </div>
  );
}

function StatusCheckCard({ check }: { check: OpenStatusCheck }) {
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<EditorProgressStatus | null>(null);
  const [answered, setAnswered] = useState<EditorProgressStatus | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function send(status: EditorProgressStatus) {
    setChoice(status);
    setError(null);
    start(async () => {
      const res = await submitEditorStatus(check.id, status, note);
      if (res.ok) setAnswered(status);
      else setError(res.message ?? "Opslaan lukte niet. Probeer het nog een keer.");
    });
  }

  const pre = check.kind === "pre_deadline";

  if (answered) {
    const opt = EDITOR_PROGRESS_OPTIONS.find((o) => o.key === answered)!;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-lg)] border border-[var(--color-good)]/30 bg-[var(--color-good-soft)] px-4 py-3 text-sm">
        <span className="font-semibold text-[var(--color-ink)]">{opt.emoji} Doorgegeven: {opt.label.toLowerCase()}</span>
        <span className="text-[var(--color-ink-muted)]">{check.projectName}. Thanks, Team Shortclips is op de hoogte.</span>
        <button type="button" onClick={() => setAnswered(null)} className="ml-auto text-xs font-semibold text-[var(--color-ink-muted)] underline-offset-2 hover:underline">
          Wijzigen
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-brand-500)]/35 bg-[var(--color-surface)]">
      <div className="px-4 pb-3 pt-4 sm:px-5">
        <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          Statuscheck{check.editorDueOn ? ` · editor deadline ${fmtDeadline(check.editorDueOn)}` : ""}
        </p>
        <h2 className="mt-1 text-base font-bold tracking-tight">Hey! 👋</h2>
        {pre ? (
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink)]">
            De deadline van <strong>{check.projectName}</strong> is bijna bereikt. Lukt het om op tijd op te leveren?
            Geef hieronder kort je status door, dan kan Team Shortclips op tijd meedenken. Thanks!
          </p>
        ) : (
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink)]">
            Je bent inmiddels halverwege de deadline van <strong>{check.projectName}</strong>. Ben je al begonnen met het editen?
            We ontvangen graag een korte update over de voortgang, zodat Team Shortclips weet hoe het ervoor staat.
            Kun je hieronder je status doorgeven? Thanks!
          </p>
        )}
      </div>
      <div className="space-y-2.5 border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-3 sm:px-5">
        <input
          type="text"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optioneel: korte toelichting, bijv. 'wacht nog op muziek'"
          className="sc-input h-10 w-full text-sm"
          aria-label="Korte toelichting (optioneel)"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          {EDITOR_PROGRESS_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={pending}
              onClick={() => send(o.key)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-sm font-semibold text-[var(--color-ink)] transition hover:border-[var(--color-ink)] disabled:opacity-60"
            >
              {pending && choice === o.key ? <Loader2 className="size-4 animate-spin" /> : <span aria-hidden>{o.emoji}</span>}
              {o.label}
            </button>
          ))}
        </div>
        {error ? <p className="text-xs font-medium text-[var(--color-bad)]">{error}</p> : null}
      </div>
    </div>
  );
}
