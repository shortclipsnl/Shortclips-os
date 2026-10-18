"use client";

import { useState } from "react";
import { Check, Copy, History, Lightbulb } from "lucide-react";

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

/** Korte uitleg boven een AI-tool: wat je invult en wat je terugkrijgt. */
export function ToolHowTo({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] bg-[var(--color-info-soft)] px-3 py-2.5 text-sm text-[var(--color-ink)]">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-[var(--color-info)]" />
      <div>
        <p className="font-semibold">Zo werkt het</p>
        <p className="mt-0.5 text-[var(--color-ink-muted)]">{children}</p>
      </div>
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
