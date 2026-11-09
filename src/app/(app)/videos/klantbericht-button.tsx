"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Eye, Loader2, RotateCcw, Save, X } from "lucide-react";
import { updateKlantbericht } from "@/server/actions/klantbericht";

const LINK_PLACEHOLDER = "[Voeg videolink toe]";

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

/** Kort "Bericht gekopieerd" tonen na het kopiëren. */
function useCopyFeedback() {
  const [state, setState] = useState<"ok" | "fout" | null>(null);
  async function copy(text: string) {
    const ok = await copyText(text);
    setState(ok ? "ok" : "fout");
    setTimeout(() => setState(null), 2200);
    return ok;
  }
  return { state, copy };
}

/**
 * Opleveringsbericht voor de eerste versies van de video's.
 * - "Kopieer opleveringsbericht": kopieert direct het standaardbericht.
 * - "Bekijk en pas aan": opent het bericht; de medewerker kan het voor deze klant
 *   aanpassen (bijv. meteen de videolink invullen) en dan kopiëren. Die aanpassing
 *   geldt alleen voor dit ene bericht.
 * - Beheerders kunnen in hetzelfde venster de standaardtekst voor iedereen opslaan.
 */
export function KlantberichtButton({ text, canManage }: { text: string; canManage: boolean }) {
  const [standard, setStandard] = useState(text);
  const [open, setOpen] = useState(false);
  const { state, copy } = useCopyFeedback();

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => copy(standard)}
        title="Kopieer het video-opleveringsbericht voor de eerste versies. Voeg daarna zelf de juiste videolink toe."
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[#FF6A00] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm ring-1 ring-black/10 transition-colors hover:bg-[#e85f00]"
      >
        {state === "ok" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {state === "ok" ? "Bericht gekopieerd!" : state === "fout" ? "Kopiëren mislukt" : "Kopieer video opleveringsbericht"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Bekijk het opleveringsbericht en pas het aan voordat je het kopieert"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-white/30 bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-white/20"
      >
        <Eye className="size-3.5" /> Bekijk en pas aan
      </button>
      {open ? (
        <MessageDialog
          standard={standard}
          canManage={canManage}
          onClose={() => setOpen(false)}
          onStandardSaved={setStandard}
        />
      ) : null}
    </div>
  );
}

function MessageDialog({
  standard,
  canManage,
  onClose,
  onStandardSaved,
}: {
  standard: string;
  canManage: boolean;
  onClose: () => void;
  onStandardSaved: (text: string) => void;
}) {
  const [val, setVal] = useState(standard);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const { state, copy } = useCopyFeedback();
  const changed = val !== standard;
  const linkMissing = val.includes(LINK_PLACEHOLDER);

  const saveStandard = (reset = false) =>
    start(async () => {
      setNotice(null);
      const r = await updateKlantbericht(val, { reset });
      if (r.ok) {
        onStandardSaved(r.text);
        setVal(r.text);
        setNotice({ tone: "ok", text: reset ? "Standaardtekst hersteld voor iedereen." : "Opgeslagen als standaard voor iedereen." });
      } else {
        setNotice({ tone: "bad", text: r.message });
      }
    });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 text-[var(--color-ink)]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Opleveringsbericht"
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-raised)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h3 className="text-base font-bold">Opleveringsbericht eerste versies</h3>
          <button type="button" onClick={onClose} aria-label="Sluiten" className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-[var(--color-ink-muted)]">
          Pas het bericht gerust aan voor deze klant en vul de videolink in. Je aanpassing geldt alleen voor dit bericht; de standaardtekst blijft hetzelfde.
        </p>

        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          rows={18}
          aria-label="Tekst van het opleveringsbericht"
          className="sc-input min-h-[260px] w-full flex-1 resize-y py-2.5 text-sm leading-relaxed"
        />

        {linkMissing ? (
          <p className="mt-2 text-xs font-medium text-[var(--color-warn)]">Let op: de videolink is nog niet ingevuld. Vervang {LINK_PLACEHOLDER} of voeg de link na het plakken toe.</p>
        ) : null}
        {notice ? (
          <p className={`mt-2 text-xs font-medium ${notice.tone === "ok" ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{notice.text}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            {changed ? (
              <button type="button" onClick={() => setVal(standard)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                <RotateCcw className="size-3.5" /> Terug naar standaardtekst
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-medium">
              Sluiten
            </button>
            <button
              type="button"
              disabled={!val.trim()}
              onClick={() => copy(val)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-indigo-soft)] disabled:opacity-50"
            >
              {state === "ok" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {state === "ok" ? "Bericht gekopieerd" : state === "fout" ? "Kopiëren mislukt" : "Kopieer bericht"}
            </button>
          </div>
        </div>

        {/* Alleen beheerders: de standaardtekst voor het hele team wijzigen. */}
        {canManage ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] pt-3">
            <span className="text-2xs text-[var(--color-ink-faint)]">Beheer: standaardtekst voor alle medewerkers</span>
            <div className="flex items-center gap-3">
              <button type="button" disabled={pending} onClick={() => saveStandard(true)} className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50">
                Standaardtekst herstellen
              </button>
              <button
                type="button"
                disabled={pending || !changed || !val.trim()}
                onClick={() => saveStandard(false)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Opslaan als standaard
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
