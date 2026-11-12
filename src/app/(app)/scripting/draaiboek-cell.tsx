"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, ClipboardList, Loader2 } from "lucide-react";
import { generateDraaiboekAction } from "@/server/actions/draaiboek";
import type { DraaiboekSummary } from "@/server/draaiboek/service";
import type { ScriptingRow } from "@/server/scripting";

const first = (n: string | null) => (n ? n.split(" ")[0] : "videograaf");

/**
 * Draaiboek per opnamesessie: genereren uit de script-PDF van de sessie, of het
 * bestaande draaiboek bekijken (met de status, bv. "Verstuurd naar Rutger").
 */
export function DraaiboekCell({ row, summary, canManage }: { row: ScriptingRow; summary: DraaiboekSummary | null; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const hasPdf = Boolean(row.linkedPdf || row.reviewId);

  if (summary) {
    const label =
      summary.status === "verstuurd"
        ? `Verstuurd naar ${first(summary.sentToName)}`
        : summary.status === "afgerond"
          ? "Opname afgerond"
          : summary.status === "afgerond_open"
            ? "Afgerond, open punten"
            : "Concept, controleren";
    const tone =
      summary.status === "concept" ? "bg-[var(--color-warn-soft)] text-[#8a5300]" : summary.status === "afgerond_open" ? "bg-[var(--color-warn-soft)] text-[#8a5300]" : "bg-[var(--color-good-soft)] text-[var(--color-good)]";
    return (
      <div className="flex w-[150px] flex-col gap-1">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${tone}`}>
          {summary.status !== "concept" ? <CheckCircle2 className="size-3" /> : null}
          <span className="truncate">{label}</span>
        </span>
        <Link
          href={canManage ? `/draaiboek/${row.id}/controle` : `/draaiboek/${row.id}`}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)]"
        >
          <ClipboardList className="size-3.5" /> Draaiboek bekijken
        </Link>
      </div>
    );
  }

  if (!canManage) return <span className="text-2xs text-[var(--color-ink-faint)]">Nog geen draaiboek</span>;
  if (!hasPdf) return <span className="block w-[150px] text-2xs leading-snug text-[var(--color-ink-faint)]">Koppel eerst de script-PDF om een draaiboek te maken</span>;

  return (
    <div className="w-[150px]">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await generateDraaiboekAction(row.id);
            if (res.ok) router.push(`/draaiboek/${row.id}/controle`);
            else setError(res.message ?? "Niet gelukt.");
          });
        }}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-2 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardList className="size-3.5" />}
        {pending ? "Draaiboek maken…" : "Genereer draaiboek"}
      </button>
      {error ? <p className="mt-1 text-2xs leading-snug text-[var(--color-bad)]">{error}</p> : null}
    </div>
  );
}
