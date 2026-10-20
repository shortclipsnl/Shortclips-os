"use client";

import { useState } from "react";
import { Bot, X } from "lucide-react";
import { AssistantConsole } from "@/app/(app)/ai/assistent/assistant-ui";

/**
 * Zwevende AI-assistent, rechtsonder in beeld op elke pagina. Het team kan hier
 * snel een vraag stellen over scripts, opnames, editing, planning en deadlines —
 * zonder een aparte pagina. Opent een paneel met dezelfde assistent-console.
 */
export function AssistantWidget({ firstName, aiReady }: { firstName: string; aiReady: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open ? (
        <div className="fixed bottom-20 right-4 z-40 flex h-[70vh] max-h-[640px] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)]">
          <div className="flex items-center justify-between gap-2 bg-[var(--color-indigo-ink)] px-4 py-3 text-white">
            <span className="flex items-center gap-2 text-sm font-bold tracking-tight"><Bot className="size-4" /> AI Assistent</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Sluiten" className="grid size-7 place-items-center rounded hover:bg-white/15">
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <AssistantConsole firstName={firstName} aiReady={aiReady} />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "AI Assistent sluiten" : "AI Assistent openen"}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[var(--color-indigo-ink)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-raised)] transition hover:bg-[var(--color-indigo-soft)]"
      >
        {open ? <X className="size-5" /> : <Bot className="size-5" />}
        {open ? "Sluiten" : "Vraag de AI"}
      </button>
    </>
  );
}
