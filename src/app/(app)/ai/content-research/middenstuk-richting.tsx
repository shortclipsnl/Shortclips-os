"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { saveMiddenstukRichting } from "@/server/actions/content-research";

/**
 * Eigen richting voor het middenstuk. Slaat op bij het verlaten van het veld;
 * gaat mee naar de Script Engine en in "Idee kopiëren".
 */
export function MiddenstukRichting({
  ideaId,
  initial,
  onChange,
}: {
  ideaId: string;
  initial: string | null;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const id = `richting-${ideaId}`;

  function save() {
    if ((initial ?? "") === value.trim()) return;
    start(async () => {
      const res = await saveMiddenstukRichting(ideaId, value);
      setSaved(res.ok);
      if (res.ok) setTimeout(() => setSaved(false), 1800);
    });
  }

  return (
    <div>
      <label htmlFor={id} className="flex items-center justify-between text-xs font-medium text-[var(--color-ink)]">
        <span>Jouw richting voor het middenstuk <span className="font-normal text-[var(--color-ink-faint)]">(optioneel)</span></span>
        {pending ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : saved ? <span className="inline-flex items-center gap-1 text-2xs text-[var(--color-good)]"><Check className="size-3" /> Opgeslagen</span> : null}
      </label>
      <textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(e.target.value);
        }}
        onBlur={save}
        placeholder="Bijv. laat vooral de prijzen zien, Bas in beeld, eindigen bij de showroom"
        className="sc-input mt-1 w-full resize-y text-sm"
      />
    </div>
  );
}
