"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, ExternalLink, FileText, Loader2, MoreVertical, Search, Trash2 } from "lucide-react";
import { Stat } from "@/components/ui";
import { euro } from "@/lib/quotes";
import { deleteQuote, duplicateQuote } from "@/server/actions/quotes";
import type { QuoteListRow } from "@/server/quotes";

const STATUS_META: Record<string, { label: string; color: string }> = {
  concept: { label: "Concept", color: "var(--color-ink-muted)" },
  verzonden: { label: "Verzonden", color: "var(--color-info)" },
  bekeken: { label: "Bekeken", color: "var(--color-violet)" },
  geaccepteerd: { label: "Geaccepteerd", color: "var(--color-good)" },
  ondertekend: { label: "Ondertekend", color: "var(--color-good)" },
  afgewezen: { label: "Afgewezen", color: "var(--color-bad)" },
  verlopen: { label: "Verlopen", color: "var(--color-warn)" },
};

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

type Stats = { total: number; concept: number; verzonden: number; bekeken: number; geaccepteerd: number; ondertekend: number; afgewezen: number };

export function OffertesBoard({ rows, stats }: { rows: QuoteListRow[]; stats: Stats }) {
  const [status, setStatus] = useState<string>("alle");
  const [q, setQ] = useState("");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === "geaccepteerd" ? !["geaccepteerd", "ondertekend"].includes(r.status) : status !== "alle" && r.status !== status) return false;
      if (needle) {
        const hay = `${r.number} ${r.title} ${r.clientName ?? ""} ${r.recipientCompany ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, status, q]);

  function copyLink(link: string, id: string) {
    navigator.clipboard?.writeText(link).then(() => { setCopied(id); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  }

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Totaal" value={String(stats.total)} onClick={() => setStatus("alle")} active={status === "alle"} />
        <Stat label="Concept" value={String(stats.concept)} onClick={() => setStatus("concept")} active={status === "concept"} />
        <Stat label="Verzonden" value={String(stats.verzonden)} tone="info" onClick={() => setStatus("verzonden")} active={status === "verzonden"} />
        <Stat label="Bekeken" value={String(stats.bekeken)} tone="info" onClick={() => setStatus("bekeken")} active={status === "bekeken"} />
        <Stat label="Geaccepteerd" value={String(stats.geaccepteerd + stats.ondertekend)} tone="good" onClick={() => setStatus("geaccepteerd")} active={status === "geaccepteerd"} />
        <Stat label="Afgewezen" value={String(stats.afgewezen)} tone="warn" onClick={() => setStatus("afgewezen")} active={status === "afgewezen"} />
      </div>

      <div className="mb-3 flex items-center justify-end">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input className="sc-input h-8 w-56 py-0 pl-7 text-xs" placeholder="Zoek op klant, nummer, titel…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] text-left text-xs text-[var(--color-ink-faint)]">
              <th className="px-3 py-2 font-medium">Offerte</th>
              <th className="px-2 py-2 font-medium">Klant</th>
              <th className="px-2 py-2 text-right font-medium">Bedrag</th>
              <th className="px-2 py-2 font-medium">Aangemaakt</th>
              <th className="px-2 py-2 font-medium">Laatst bekeken</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.concept!;
              return (
                <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-surface-sunken)]/40" style={{ boxShadow: `inset 3px 0 0 ${meta.color}` }}>
                  <td className="px-3 py-2">
                    <Link href={`/offertes/${r.id}`} className="font-medium text-[var(--color-ink)] hover:underline">{r.title}</Link>
                    <div className="text-2xs text-[var(--color-ink-faint)]">Nr. {r.number}</div>
                  </td>
                  <td className="px-2 py-2 text-[var(--color-ink-muted)]">{r.clientName ?? r.recipientCompany ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{euro(r.amount)}</td>
                  <td className="px-2 py-2 text-xs text-[var(--color-ink-muted)]">{fmtDate(r.createdAt)}</td>
                  <td className="px-2 py-2 text-xs text-[var(--color-ink-muted)]">
                    {r.lastOpenedAt ? <span>{fmtDate(r.lastOpenedAt)}<span className="ml-1 text-[var(--color-ink-faint)]">· {r.openCount}×</span></span> : <span className="text-[var(--color-ink-faint)]">nog niet</span>}
                  </td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold" style={{ background: `color-mix(in srgb, ${meta.color} 14%, var(--color-surface))`, color: meta.color }}>
                      <span className="size-1.5 rounded-full" style={{ background: meta.color }} /> {meta.label}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {r.link ? (
                        <>
                          <button type="button" onClick={() => copyLink(r.link!, r.id)} title="Offertelink kopiëren" className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
                            {copied === r.id ? <span className="text-2xs font-semibold text-[var(--color-good)]">✓</span> : <Copy className="size-3.5" />}
                          </button>
                          <a href={r.link} target="_blank" rel="noopener noreferrer" title="Bekijk als klant" className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"><ExternalLink className="size-3.5" /></a>
                        </>
                      ) : null}
                      <Link href={`/offertes/${r.id}`} title="Openen" className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"><FileText className="size-3.5" /></Link>
                      <button type="button" disabled={pending} onClick={() => start(async () => { const res = await duplicateQuote(r.id); if (res.ok && res.id) router.push(`/offertes/${res.id}`); })} title="Dupliceren" className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
                        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <MoreVertical className="size-3.5" />}
                      </button>
                      <button type="button" disabled={pending} onClick={() => { if (confirm("Deze offerte verwijderen?")) start(async () => { await deleteQuote(r.id); router.refresh(); }); }} title="Verwijderen" className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]"><Trash2 className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-[var(--color-ink-faint)]">Geen offertes met deze filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
