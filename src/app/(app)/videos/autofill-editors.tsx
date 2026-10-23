"use client";

import { useState, useTransition } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { autofillEditorsFromClients } from "@/server/actions/videos";

/** Knop om op alle video's zonder editor de vaste editor van de klant in te vullen. */
export function AutofillEditorsButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg ? <span className="text-xs text-white/80">{msg}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await autofillEditorsFromClients(); setMsg(r.message ?? (r.ok ? "Klaar." : "Mislukt.")); })}
        title="Vul op video's zonder editor de vaste editor van de klant in"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Editors invullen vanuit klant
      </button>
    </div>
  );
}
