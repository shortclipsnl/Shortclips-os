"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

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

export function NoProviderNote() {
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[var(--color-ink)]">
      De AI-generatie is nog niet geactiveerd. Zet <code className="font-mono">ANTHROPIC_API_KEY</code> in{" "}
      <code className="font-mono">.env.local</code> om dit live te zetten. Alle schermen en instellingen werken al.
    </div>
  );
}
