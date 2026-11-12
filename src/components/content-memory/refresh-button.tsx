"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { refreshContentMemoryAction } from "@/server/actions/content-memory";

export function RefreshMemoryButton({ clientId }: { clientId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg ? <span className="text-xs text-[var(--color-ink-muted)]">{msg}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await refreshContentMemoryAction(clientId); setMsg(r.message); })}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
      >
        <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} /> {pending ? "Bezig met analyseren..." : "Formats bijwerken"}
      </button>
    </div>
  );
}
