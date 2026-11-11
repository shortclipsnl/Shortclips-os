"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { changeQuoteStatusInPandaDoc, refreshQuoteFromPandaDoc, setQuoteLead } from "@/server/actions/pandadoc";
import { PANDADOC_SETTABLE, type SettableStatus } from "@/lib/pandadoc";

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p className={`mt-2 text-2xs font-medium ${m.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{m.text}</p>;
}

/** Statuswijziging via PandaDoc (alleen wat PandaDoc toestaat), met bevestiging. */
export function StatusActions({ quoteId, options }: { quoteId: string; options: SettableStatus[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  function change(s: SettableStatus) {
    if (!confirm(`${PANDADOC_SETTABLE[s].label}? Dit wordt direct in PandaDoc doorgevoerd. De klant krijgt hiervan geen mail.`)) return;
    start(async () => {
      const res = await changeQuoteStatusInPandaDoc({ quoteId, status: s });
      setMsg({ ok: res.ok, text: res.message ?? "" });
      router.refresh();
    });
  }
  return (
    <div className="mt-3 border-t border-[var(--color-line)] pt-3">
      <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Status wijzigen in PandaDoc</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => change(s)}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)] disabled:opacity-50">
            {s === "ondertekend" ? "Ondertekend" : s === "afgewezen" ? "Afgewezen" : "Verlopen"}
          </button>
        ))}
        {pending ? <Loader2 className="size-4 animate-spin self-center text-[var(--color-ink-faint)]" /> : null}
      </div>
      <Msg m={msg} />
    </div>
  );
}

export function RefreshButton({ quoteId }: { quoteId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <span className="text-right">
      <button type="button" disabled={pending} onClick={() => start(async () => { const r = await refreshQuoteFromPandaDoc(quoteId); setMsg({ ok: r.ok, text: r.message ?? "" }); router.refresh(); })}
        className="inline-flex items-center gap-1 font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50">
        {pending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Vernieuwen
      </button>
      {msg && !msg.ok ? <span className="block text-[var(--color-bad)]">{msg.text}</span> : null}
    </span>
  );
}

export function LeadPicker({ quoteId, current, leads }: { quoteId: string; current: string | null; leads: { id: string; company: string; status: string }[] }) {
  const [val, setVal] = useState(current ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <div>
      <select className="sc-input h-8 w-full py-0 text-xs" value={val} disabled={pending} aria-label="Lead koppelen"
        onChange={(e) => {
          const next = e.target.value;
          setVal(next);
          start(async () => { const r = await setQuoteLead({ quoteId, leadId: next || null }); setMsg({ ok: r.ok, text: r.message ?? "" }); router.refresh(); });
        }}>
        <option value="">Niet gekoppeld</option>
        {leads.map((l) => <option key={l.id} value={l.id}>{l.company}{l.status === "gewonnen" ? " (gewonnen)" : l.status === "verloren" ? " (verloren)" : ""}</option>)}
      </select>
      <Msg m={msg} />
    </div>
  );
}
