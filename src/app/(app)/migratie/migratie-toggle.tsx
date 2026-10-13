"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setMondaySync } from "@/server/actions/monday-sync";

export function MondaySyncToggle({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function toggle() {
    const next = !on;
    setError(null);
    setOn(next); // optimistisch
    start(async () => {
      const res = await setMondaySync(next);
      if (!res.ok) {
        setOn(!next);
        setError(res.message ?? "Wijzigen mislukt.");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="mb-6 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${on ? "bg-[var(--color-good)]" : "bg-[var(--color-ink-faint)]"}`} />
            <h2 className="text-sm font-bold tracking-tight">Monday-synchronisatie {on ? "actief" : "uitgeschakeld"}</h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-ink-muted)]">
            {on
              ? "De nachtelijke sync haalt nog data op uit Monday. Zet dit uit zodra de app de bron is — alle schermen blijven werken op de al overgenomen data, en er wordt niets meer uit Monday gehaald."
              : "De app is nu onafhankelijk van Monday: er wordt niets meer geïmporteerd. Zet weer aan om tijdelijk opnieuw te synchroniseren."}
          </p>
          {error ? <p className="mt-1 text-xs font-medium text-[var(--color-bad)]">{error}</p> : null}
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-pressed={on}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${on ? "bg-[var(--color-good)]" : "bg-[var(--color-line-strong)]"} disabled:opacity-60`}
        >
          <span className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
          {pending ? <Loader2 className="absolute -right-6 size-4 animate-spin text-[var(--color-ink-faint)]" /> : null}
        </button>
      </div>
    </div>
  );
}
