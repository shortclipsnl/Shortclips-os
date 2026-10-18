"use client";

import { useState } from "react";
import { Check, Copy, History, Lightbulb, Save } from "lucide-react";

/** Leest een bestand als base64 (zonder de data:-prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function CopyButton({ text, label = "Kopiëren" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard geblokkeerd — stil negeren */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
    >
      {done ? <Check className="size-3.5 text-[var(--color-good)]" /> : <Copy className="size-3.5" />}
      {done ? "Gekopieerd" : label}
    </button>
  );
}

export type HistoryEntry<T> = {
  id: string;
  title: string | null;
  clientName: string;
  createdAt: string;
  output: T;
};

export function HistoryPanel<T>({ items, onLoad }: { items: HistoryEntry<T>[]; onLoad: (output: T) => void }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium"
      >
        <History className="size-4 text-[var(--color-ink-faint)]" />
        Eerder gegenereerd ({items.length})
        <span className="ml-auto text-xs text-[var(--color-ink-faint)]">{open ? "verbergen" : "tonen"}</span>
      </button>
      {open ? (
        <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onLoad(it.output)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--color-surface-2)]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{it.title ?? "Zonder titel"}</span>
                  <span className="block truncate text-xs text-[var(--color-ink-muted)]">{it.clientName}</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">
                  {new Date(it.createdAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Korte uitleg boven een AI-tool, in opsommingsvorm (stap voor stap onder
 * elkaar) i.p.v. één tekstblok. Met `output` erbij (standaard aan) komt er een
 * vast blokje onder dat uitlegt waar het resultaat wordt opgeslagen en hoe je
 * het kopieert of als pdf bewaart.
 */
export function ToolHowTo({ steps, output = true }: { steps: string[]; output?: boolean }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-info)]/25 bg-[var(--color-info-soft)]/60 px-4 py-3 text-sm text-[var(--color-ink)]">
      <p className="flex items-center gap-2 font-semibold">
        <Lightbulb className="size-4 shrink-0 text-[var(--color-info)]" /> Zo werkt het
      </p>
      <ol className="mt-2 space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-info)] text-2xs font-bold text-white">{i + 1}</span>
            <span className="text-[var(--color-ink-muted)]">{s}</span>
          </li>
        ))}
      </ol>

      {output ? (
        <div className="mt-3 border-t border-[var(--color-info)]/20 pt-2.5">
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Save className="size-3.5 shrink-0 text-[var(--color-info)]" /> Opslaan, kopiëren &amp; pdf
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-[var(--color-ink-muted)]">
            <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Elk resultaat wordt <strong>automatisch opgeslagen</strong> onder AI-geschiedenis (in de database, per klant) — niets gaat verloren.</span></li>
            <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Klaar? Kopieer de tekst met de <strong>Kopiëren</strong>-knop bij het resultaat.</span></li>
            <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Als <strong>pdf</strong> bewaren kan via je browser: Afdrukken (⌘/Ctrl + P) → <em>Opslaan als pdf</em>.</span></li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function NoProviderNote() {
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[var(--color-ink)]">
      De AI-generatie is nog niet geactiveerd. Zet <code className="font-mono">ANTHROPIC_API_KEY</code> in{" "}
      <code className="font-mono">.env.local</code> om dit live te zetten. Alle schermen en instellingen werken al.
    </div>
  );
}
