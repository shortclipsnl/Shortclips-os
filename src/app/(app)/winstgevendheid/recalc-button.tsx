"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { recalcFinanceMonth } from "@/server/actions/finance";

/** Werkt de maandstaten van de gekozen maand direct bij uit de actuele gegevens
 *  (prijzen, tarieven en de geplande opnames). Naast de nachtelijke job, zodat je
 *  de winstgevendheid op elk moment kunt verversen. */
export function RecalcButton({ period }: { period: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await recalcFinanceMonth(period);
          setMsg(r.message ?? (r.ok ? "Bijgewerkt." : "Mislukt."));
          router.refresh();
        })}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)] disabled:opacity-50"
        title="Herbereken de maand uit de actuele prijzen, tarieven en geplande opnames"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        Herbereken maand
      </button>
      {msg ? <span className="text-xs text-[var(--color-ink-muted)]">{msg}</span> : null}
    </span>
  );
}
