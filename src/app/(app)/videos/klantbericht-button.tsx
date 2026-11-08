"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, Pencil, X } from "lucide-react";
import { updateKlantbericht } from "@/server/actions/klantbericht";

/** Tekst naar het klembord, met terugval voor oudere browsers / niet-beveiligde context. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // val terug op de oude methode hieronder
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * "Kopieer klantbericht": kopieert het vaste bericht voor de eerste versies, zodat
 * het team het direct in WhatsApp (of een ander kanaal) kan plakken. De videolink
 * voegt de medewerker zelf toe. Beheerders kunnen de tekst centraal aanpassen.
 */
export function KlantberichtButton({ text, canManage }: { text: string; canManage: boolean }) {
  const [current, setCurrent] = useState(text);
  const [copied, setCopied] = useState<"ok" | "fout" | null>(null);
  const [editing, setEditing] = useState(false);

  async function onCopy() {
    const ok = await copyText(current);
    setCopied(ok ? "ok" : "fout");
    setTimeout(() => setCopied(null), 2200);
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onCopy}
        title="Kopieer het standaardbericht voor de eerste versies. Voeg daarna zelf de juiste videolink toe."
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-indigo-ink)] shadow-sm hover:bg-white/90"
      >
        {copied === "ok" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied === "ok" ? "Bericht gekopieerd" : copied === "fout" ? "Kopiëren mislukt" : "Kopieer klantbericht"}
      </button>
      {canManage ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Standaard klantbericht aanpassen (geldt direct voor iedereen)"
          aria-label="Standaard klantbericht aanpassen"
          className="grid size-7 place-items-center rounded-[var(--radius-sm)] border border-white/30 bg-white/10 text-white hover:bg-white/20"
        >
          <Pencil className="size-3.5" />
        </button>
      ) : null}
      {editing ? <EditDialog initial={current} onClose={() => setEditing(false)} onSaved={(t) => { setCurrent(t); setEditing(false); }} /> : null}
    </div>
  );
}

function EditDialog({ initial, onClose, onSaved }: { initial: string; onClose: () => void; onSaved: (text: string) => void }) {
  const [val, setVal] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (reset = false) =>
    start(async () => {
      setError(null);
      const r = await updateKlantbericht(val, { reset });
      if (r.ok) onSaved(r.text);
      else setError(r.message);
    });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 text-[var(--color-ink)]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Standaard klantbericht aanpassen"
        className="w-full max-w-xl rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-raised)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h3 className="text-base font-bold">Standaard klantbericht</h3>
          <button type="button" onClick={onClose} aria-label="Sluiten" className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
          Wijzigingen gelden direct voor alle medewerkers. Witregels en opsommingstekens worden precies zo gekopieerd.
        </p>
        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          rows={16}
          className="sc-input w-full resize-y py-2 font-mono text-xs leading-relaxed"
        />
        {error ? <p className="mt-2 text-xs font-medium text-[var(--color-bad)]">{error}</p> : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" disabled={pending} onClick={() => save(true)} className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50">
            Standaardtekst herstellen
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-medium">
              Annuleren
            </button>
            <button type="button" disabled={pending || !val.trim()} onClick={() => save(false)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-indigo-soft)] disabled:opacity-50">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
