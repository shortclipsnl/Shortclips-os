"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Kopieert de managementsamenvatting, zodat die direct doorgestuurd kan worden. */
export function CopySummary({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* geen clipboard beschikbaar */
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-white/20"
    >
      {done ? <><Check className="size-3.5" /> Gekopieerd</> : <><Copy className="size-3.5" /> Kopieer samenvatting</>}
    </button>
  );
}
