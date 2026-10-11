"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { confirmLink, rejectLink } from "@/server/actions/link-review";
import type { LinkSuggestion } from "@/server/link-review";

function fmt(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

const CONF: Record<string, { label: string; cls: string }> = {
  high: { label: "Hoog", cls: "bg-[var(--color-good-soft)] text-[#14633a]" },
  medium: { label: "Middel", cls: "bg-[#fff3e0] text-[#8a5300]" },
  low: { label: "Laag", cls: "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]" },
};

export function LinkReview({ rows }: { rows: LinkSuggestion[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-8 text-center text-sm text-[var(--color-ink-muted)]">
        Geen open koppelsuggesties. Draai de suggestie-taak opnieuw als er nieuwe video's of opnames zijn bijgekomen.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] text-left text-xs text-[var(--color-ink-faint)]">
            <th className="px-3 py-2 font-medium">Video</th>
            <th className="px-2 py-2 font-medium">Klant</th>
            <th className="px-2 py-2 font-medium">Voorgestelde opname</th>
            <th className="px-2 py-2 font-medium">Zekerheid</th>
            <th className="px-2 py-2 text-right font-medium">Bevestigen / afwijzen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <Row key={r.id} r={r} />)}
        </tbody>
      </table>
    </div>
  );
}

function Row({ r }: { r: LinkSuggestion }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<"confirmed" | "rejected" | null>(null);
  const router = useRouter();

  function act(fn: () => Promise<{ ok: boolean }>, kind: "confirmed" | "rejected") {
    start(async () => {
      const res = await fn();
      if (res.ok) { setDone(kind); router.refresh(); }
    });
  }

  if (done) {
    return (
      <tr className="border-b border-[var(--color-line)] text-[var(--color-ink-faint)]">
        <td className="px-3 py-2 line-through">{r.title}</td>
        <td className="px-2 py-2">{r.clientName}</td>
        <td className="px-2 py-2" colSpan={3}>{done === "confirmed" ? "✓ Gekoppeld — deadline automatisch gezet" : "Afgewezen"}</td>
      </tr>
    );
  }

  const conf = CONF[r.confidence ?? "low"] ?? CONF.low!;
  return (
    <tr className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-surface-sunken)]/40">
      <td className="px-3 py-2">
        <div className="font-medium text-[var(--color-ink)]">{r.title}</div>
        {r.dueOn ? <div className="text-2xs text-[var(--color-ink-faint)]">huidige deadline {fmt(r.dueOn)}</div> : null}
      </td>
      <td className="px-2 py-2 text-[var(--color-ink-muted)]">{r.clientName}</td>
      <td className="px-2 py-2">
        <div className="text-[var(--color-ink)]">{fmt(r.suggestedShootOn)}</div>
        {r.suggestedShootTitle ? <div className="text-2xs text-[var(--color-ink-faint)]">{r.suggestedShootTitle}</div> : null}
      </td>
      <td className="px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${conf.cls}`}>{conf.label}</span></td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-end gap-1.5">
          <button type="button" disabled={pending} onClick={() => act(() => confirmLink(r.id), "confirmed")}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-good)] px-2.5 py-1 text-2xs font-semibold text-white hover:opacity-90">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Bevestigen
          </button>
          <button type="button" disabled={pending} onClick={() => act(() => rejectLink(r.id), "rejected")}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-bad)]">
            <X className="size-3.5" /> Afwijzen
          </button>
        </div>
      </td>
    </tr>
  );
}
