"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightCircle, Check, Loader2, Plus, Search } from "lucide-react";
import { convertLeadToClient, createLead, setLeadFollowUp, setLeadStatus } from "@/server/actions/leads";
import type { LeadRow } from "@/server/leads";
import { LEAD_STATUS } from "@/lib/statuses";

/** Snel een nieuwe lead toevoegen (handmatig, naast de webhook-intake). */
export function QuickAddLead() {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!company.trim()) return;
    start(async () => {
      const res = await createLead({ company, contactName: contact || undefined, email: email || undefined, phone: phone || undefined });
      if (res.ok) { setCompany(""); setContact(""); setEmail(""); setPhone(""); setErr(null); setOpen(false); router.refresh(); }
      else setErr(res.message ?? "Mislukt");
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mb-4 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
        <Plus className="size-4" /> Nieuwe lead
      </button>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <input className="sc-input h-8 min-w-44 flex-1 py-0 text-sm" placeholder="Bedrijf / lead *" value={company}
        onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} autoFocus />
      <input className="sc-input h-8 w-36 py-0 text-sm" placeholder="Contactpersoon" value={contact} onChange={(e) => setContact(e.target.value)} />
      <input className="sc-input h-8 w-44 py-0 text-sm" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="sc-input h-8 w-36 py-0 text-sm" placeholder="Telefoon" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button type="button" onClick={add} disabled={pending || !company.trim()}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Toevoegen
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-2 py-1.5 text-xs text-[var(--color-ink-muted)]">Annuleren</button>
      {err ? <span className="text-xs text-[var(--color-bad)]">{err}</span> : null}
    </div>
  );
}

const STATUSES = ["lead", "offerte", "onderhandeling", "gewonnen", "verloren"] as const;
type Status = (typeof STATUSES)[number];

// Centrale lead-statuskleuren (zie lib/statuses.ts). Toon → pill-stijl + accentdot.
const TONE_PILL: Record<string, string> = {
  neutral: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
  info: "bg-[var(--color-info-soft)] text-[#0060a8]",
  good: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
  warn: "bg-[var(--color-warn-soft)] text-[#8a5300]",
  bad: "bg-[var(--color-bad-soft)] text-[#a3271c]",
  lime: "bg-[var(--color-lime-soft)] text-[#54700a]",
  ink: "bg-[var(--color-indigo-ink)] text-white",
};
const statusPill = (s: string) => TONE_PILL[LEAD_STATUS[s]?.tone ?? "neutral"]!;

function fmtDate(d: string | null) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

export function LeadsBoard({ rows, segments, sources }: { rows: LeadRow[]; segments: string[]; sources: string[] }) {
  const [status, setStatus] = useState<string>("open");
  const [segment, setSegment] = useState<string>("alle");
  const [source, setSource] = useState<string>("alle");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === "open" ? !["lead", "offerte", "onderhandeling"].includes(r.status) : status !== "alle" && r.status !== status) return false;
      if (segment !== "alle" && r.segment !== segment) return false;
      if (source !== "alle" && r.source !== source) return false;
      if (needle) {
        const hay = `${r.company} ${r.contactName ?? ""} ${r.email ?? ""} ${r.phone ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, status, segment, source, q]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {(["open", "lead", "offerte", "onderhandeling", "gewonnen", "verloren", "alle"] as const).map((s) => {
            const meta = LEAD_STATUS[s];
            const label = s === "open" ? "Open" : s === "alle" ? "Alle" : meta?.label ?? s;
            return (
              <button key={s} type="button" onClick={() => setStatus(s)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${status === s ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]"}`}>
                {meta ? <span className="size-2 rounded-full" style={{ background: meta.dot }} /> : null}
                {label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="sc-input h-8 w-auto py-0 text-xs" value={segment} onChange={(e) => setSegment(e.target.value)} aria-label="Jaargang">
            <option value="alle">Alle jaren</option>
            {segments.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="sc-input h-8 w-auto py-0 text-xs" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Bron">
            <option value="alle">Alle bronnen</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            <input className="sc-input h-8 w-44 py-0 pl-7 text-xs" placeholder="Zoek naam/e-mail…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="mb-2 text-xs text-[var(--color-ink-faint)]">{filtered.length} van {rows.length} leads</div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] text-left text-xs text-[var(--color-ink-faint)]">
              <th className="px-3 py-2 font-medium">Lead</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Bron</th>
              <th className="px-2 py-2 text-center font-medium">Score</th>
              <th className="px-2 py-2 font-medium">Contact</th>
              <th className="px-2 py-2 font-medium">Opvolgen</th>
              <th className="px-2 py-2 font-medium">Deal closer</th>
              <th className="px-2 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => <LeadRowView key={r.id} r={r} today={today} />)}
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--color-ink-faint)]">Geen leads met deze filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadRowView({ r, today }: { r: LeadRow; today: string }) {
  const [status, setStatusLocal] = useState(r.status as Status);
  const [followUp, setFollowUp] = useState(r.followUpOn ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();

  function changeStatus(next: Status) {
    setStatusLocal(next);
    start(async () => { await setLeadStatus({ id: r.id, status: next }); router.refresh(); });
  }
  function changeFollowUp(v: string) {
    setFollowUp(v);
    start(async () => { await setLeadFollowUp({ id: r.id, followUpOn: v || null }); router.refresh(); });
  }

  const overdue = ["lead", "offerte", "onderhandeling"].includes(status) && followUp && followUp <= today;

  return (
    <tr className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-surface-sunken)]/40"
      style={{ boxShadow: `inset 3px 0 0 ${overdue ? "var(--color-bad)" : LEAD_STATUS[status]?.dot ?? "transparent"}` }}>
      <td className="px-3 py-2">
        <div className="font-medium text-[var(--color-ink)]">{r.company}</div>
        <div className="text-2xs text-[var(--color-ink-faint)]">
          {r.contactName ? `${r.contactName} · ` : ""}{r.segment ?? ""}
          {r.mondayStatus && r.mondayStatus.toLowerCase() !== status ? ` · Monday: ${r.mondayStatus}` : ""}
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="relative inline-flex items-center">
          <select value={status} onChange={(e) => changeStatus(e.target.value as Status)} disabled={pending}
            className={`appearance-none rounded-full px-2.5 py-1 pr-6 text-xs font-medium ${statusPill(status)} cursor-pointer`}>
            {STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS[s]?.label ?? s}</option>)}
          </select>
          {pending ? <Loader2 className="pointer-events-none absolute right-1.5 size-3 animate-spin opacity-60" /> : null}
        </div>
      </td>
      <td className="px-2 py-2 text-xs text-[var(--color-ink-muted)]">{r.source ?? "–"}</td>
      <td className="px-2 py-2 text-center">
        {r.leadScore != null ? (
          <span className="inline-flex items-center gap-1 text-xs tabular-nums">
            {r.leadClass ? <strong>{r.leadClass}</strong> : null}{r.leadScore}
          </span>
        ) : <span className="text-[var(--color-ink-faint)]">–</span>}
      </td>
      <td className="px-2 py-2 text-xs">
        {r.email ? <a href={`mailto:${r.email}`} className="block truncate text-[var(--color-brand-700)] hover:underline max-w-[180px]">{r.email}</a> : null}
        {r.phone ? <span className="text-[var(--color-ink-muted)]">{r.phone}</span> : null}
        {!r.email && !r.phone ? <span className="text-[var(--color-ink-faint)]">–</span> : null}
      </td>
      <td className="px-2 py-2">
        <input type="date" value={followUp} onChange={(e) => changeFollowUp(e.target.value)}
          className={`sc-input h-7 w-32 py-0 text-xs ${overdue ? "text-[var(--color-bad)] font-semibold" : ""}`}
          title={followUp ? `Opvolgen voor ${fmtDate(followUp)}` : "Geen opvolgdatum"} />
      </td>
      <td className="px-2 py-2 text-xs text-[var(--color-ink-muted)]">{r.ownerName ?? "–"}</td>
      <td className="px-2 py-2 text-right">
        <ConvertCell id={r.id} convertedSlug={r.convertedClientSlug} />
      </td>
    </tr>
  );
}

function ConvertCell({ id, convertedSlug }: { id: string; convertedSlug: string | null }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  if (convertedSlug) {
    return (
      <a href={`/clients/${convertedSlug}`} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good-soft)] px-2.5 py-1 text-2xs font-medium text-[#14633a] hover:underline" title="Deze lead is al een klant">
        <Check className="size-3.5" /> Klant
      </a>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button type="button" disabled={pending}
        onClick={() => start(async () => {
          setErr(null);
          const res = await convertLeadToClient(id);
          if (res.ok && res.slug) router.push(`/clients/${res.slug}`);
          else { setErr(res.message ?? "Mislukt"); router.refresh(); }
        })}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-surface-sunken)]"
        title="Zet deze lead om naar een klant (neemt gegevens automatisch over)">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRightCircle className="size-3.5" />} Naar klant
      </button>
      {err ? <span className="text-2xs text-[var(--color-bad)]">{err}</span> : null}
    </span>
  );
}
