"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DownloadCloud, Loader2 } from "lucide-react";

type Result = { ok: boolean; error?: string; processed?: number; created?: number; updated?: number; failed?: number; jobError?: string | null };

/**
 * Eigenaar-knop: haalt de lopende editing-opdrachten éénmalig uit Monday op
 * (fase, editor, deadline, downloadlink, script). Idempotent — meermaals
 * draaien kan geen kwaad. Bedoeld om Monday leeg te trekken en daarna los te
 * koppelen.
 */
export function MondayImportButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const router = useRouter();

  async function run() {
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/import-editing", { method: "POST" });
      const data = (await res.json()) as Result;
      setResult(res.ok ? data : { ok: false, error: data.error ?? "Mislukt." });
      if (res.ok) router.refresh();
    } catch {
      setResult({ ok: false, error: "Kon de overname niet starten." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Editingdata uit Monday overnemen</p>
          <p className="text-xs text-[var(--color-ink-muted)]">
            Haalt de lopende opdrachten op (fase, editor, deadline, downloadlink, script). Veilig om vaker te draaien.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-indigo-soft)] disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <DownloadCloud className="size-3.5" />}
          {pending ? "Bezig met overnemen…" : "Nu overnemen uit Monday"}
        </button>
      </div>
      {result ? (
        result.ok ? (
          <p className="mt-2 text-xs font-medium text-[var(--color-good)]">
            Klaar — {result.created ?? 0} nieuw, {result.updated ?? 0} bijgewerkt
            {result.failed ? `, ${result.failed} niet herkend (geen klant-match)` : ""}.
          </p>
        ) : (
          <p className="mt-2 text-xs font-medium text-[var(--color-bad)]">{result.error ?? result.jobError ?? "Mislukt."}</p>
        )
      ) : null}
    </div>
  );
}
