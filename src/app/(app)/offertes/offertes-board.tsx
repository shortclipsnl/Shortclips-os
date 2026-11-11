"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Eye, FileSignature, Loader2, Percent, RefreshCw, Search, Wallet } from "lucide-react";
import { Stat } from "@/components/ui";
import { euro } from "@/lib/quotes";
import { pandadocDocumentUrl } from "@/lib/pandadoc";
import { syncPandaDocNow } from "@/server/actions/pandadoc";
import type { QuoteListRow, QuotesStats } from "@/server/quotes";
import { QUOTE_STATUS_META, StatusPill, fmtDate, followUpHint } from "./quote-status";

const DAY = 24 * 60 * 60 * 1000;

type SyncInfo = { configured: boolean; at: string | null; ok: boolean; message: string | null };

const PERIODS = [
  { value: "alle", label: "Alle data" },
  { value: "30", label: "Laatste 30 dagen" },
  { value: "90", label: "Laatste 90 dagen" },
  { value: "jaar", label: "Dit jaar" },
] as const;

export function OffertesBoard({ rows, stats, owners, sync }: { rows: QuoteListRow[]; stats: QuotesStats; owners: string[]; sync: SyncInfo }) {
  const [status, setStatus] = useState<string>("alle");
  const [period, setPeriod] = useState<string>("alle");
  const [owner, setOwner] = useState<string>("alle");
  const [q, setQ] = useState("");
  const [now] = useState(() => Date.now());

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const yearStart = new Date(new Date(now).getFullYear(), 0, 1).getTime();
    return rows.filter((r) => {
      if (status === "open" ? !["verzonden", "bekeken"].includes(r.status) : status === "ondertekend" ? !["ondertekend", "geaccepteerd"].includes(r.status) : status !== "alle" && r.status !== status) return false;
      const d = new Date(r.sentAt ?? r.createdAt).getTime();
      if (period === "30" && now - d > 30 * DAY) return false;
      if (period === "90" && now - d > 90 * DAY) return false;
      if (period === "jaar" && d < yearStart) return false;
      if (owner !== "alle" && r.ownerName !== owner) return false;
      if (needle) {
        const hay = `${r.number} ${r.title} ${r.clientName ?? ""} ${r.recipientCompany ?? ""} ${r.leadCompany ?? ""} ${r.contactName ?? ""} ${r.contactEmail ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, status, period, owner, q, now]);

  return (
    <div>
      <SyncBar sync={sync} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Openstaande offertes" value={String(stats.open)} hint="wachten op de klant" tone="info" icon={<Clock />} onClick={() => setStatus("open")} active={status === "open"} />
        <Stat label="Openstaande waarde" value={euro(stats.openValue)} hint={stats.openWithoutAmount ? `excl. btw · ${stats.openWithoutAmount} zonder bedrag` : "excl. btw"} icon={<Wallet />} onClick={() => setStatus("open")} active={false} />
        <Stat label="Ondertekend" value={String(stats.signed)} tone="good" icon={<CheckCircle2 />} onClick={() => setStatus("ondertekend")} active={status === "ondertekend"} />
        <Stat label="Conversie" value={stats.conversion == null ? "–" : `${Math.round(stats.conversion * 100)}%`} hint={`van ${stats.signed + stats.declined + stats.expired} afgeronde offertes`} icon={<Percent />} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {(["alle", "open", "concept", "verzonden", "bekeken", "ondertekend", "afgewezen", "verlopen"] as const).map((s) => {
            const meta = QUOTE_STATUS_META[s];
            const label = s === "alle" ? "Alle" : s === "open" ? "Openstaand" : s === "bekeken" ? "Bekeken" : meta?.label ?? s;
            return (
              <button key={s} type="button" onClick={() => setStatus(s)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${status === s ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
                {meta ? <span className="size-2 rounded-full" style={{ background: meta.color }} /> : null}
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <select className="sc-input h-8 w-auto py-0 text-xs" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Periode">
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {owners.length > 1 ? (
            <select className="sc-input h-8 w-auto py-0 text-xs" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Verantwoordelijke">
              <option value="alle">Alle medewerkers</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : null}
          <div className="relative flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            <input className="sc-input h-8 w-full py-0 pl-7 text-xs sm:w-56" placeholder="Zoek klant, contact, nummer…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="mb-2 text-xs text-[var(--color-ink-faint)]">{filtered.length} van {rows.length} offertes · nieuwste bovenaan</div>

      {/* Desktop: tabel */}
      <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)] md:block">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] text-left text-xs text-[var(--color-ink-faint)]">
              <th className="px-3 py-2 font-medium">Klant</th>
              <th className="px-2 py-2 font-medium">Offerte</th>
              <th className="px-2 py-2 text-right font-medium">Bedrag</th>
              <th className="px-2 py-2 font-medium">Verzonden</th>
              <th className="px-2 py-2 font-medium">Klantactiviteit</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Lead</th>
              <th className="px-2 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => <Row key={r.id} r={r} />)}
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-[var(--color-ink-faint)]">Geen offertes met deze filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Mobiel: kaarten */}
      <div className="space-y-2 md:hidden">
        {filtered.map((r) => <MobileCard key={r.id} r={r} />)}
        {filtered.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-ink-faint)]">Geen offertes met deze filters.</p> : null}
      </div>
    </div>
  );
}

function customer(r: QuoteListRow) {
  return r.clientName ?? r.leadCompany ?? r.recipientCompany ?? r.contactEmail ?? "Onbekende klant";
}

function Activity({ r }: { r: QuoteListRow }) {
  const hint = followUpHint(r);
  if (r.signedAt && (r.status === "ondertekend" || r.status === "geaccepteerd")) {
    return <span className="text-xs text-[var(--color-good)]">Getekend {fmtDate(r.signedAt)}</span>;
  }
  return (
    <span className="text-xs text-[var(--color-ink-muted)]">
      {r.firstOpenedAt ? (
        <span className="inline-flex items-center gap-1"><Eye className="size-3.5" /> {fmtDate(r.firstOpenedAt)}<span className="text-[var(--color-ink-faint)]">· {r.openCount}× bekeken</span></span>
      ) : r.sentAt ? <span className="text-[var(--color-ink-faint)]">Nog niet geopend</span> : <span className="text-[var(--color-ink-faint)]">–</span>}
      {hint ? <span className="ml-1.5 rounded-full bg-[var(--color-warn-soft)] px-1.5 py-0.5 text-2xs font-semibold text-[#8a5300]">Opvolgen</span> : null}
    </span>
  );
}

function LeadCell({ r }: { r: QuoteListRow }) {
  if (r.leadId) {
    return (
      <Link href={`/leads?lead=${r.leadId}`} className="inline-flex max-w-[150px] items-center gap-1 truncate rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-2xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" title={`Gekoppeld via ${r.leadMatch ?? "onbekend"}`}>
        {r.leadCompany ?? "Lead"}
      </Link>
    );
  }
  if (r.clientSlug) return <Link href={`/clients/${r.clientSlug}`} className="text-2xs font-semibold text-[var(--color-ink-muted)] hover:underline">Klant</Link>;
  return <Link href={`/offertes/${r.id}#koppelen`} className="text-2xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:underline">Koppelen</Link>;
}

function Row({ r }: { r: QuoteListRow }) {
  const meta = QUOTE_STATUS_META[r.status] ?? QUOTE_STATUS_META.concept!;
  return (
    <tr className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-surface-sunken)]/40" style={{ boxShadow: `inset 3px 0 0 ${meta.color}` }}>
      <td className="px-3 py-2">
        <Link href={`/offertes/${r.id}`} className="font-medium text-[var(--color-ink)] hover:underline">{customer(r)}</Link>
        <div className="max-w-[220px] truncate text-2xs text-[var(--color-ink-faint)]">{[r.contactName, r.contactEmail].filter(Boolean).join(" · ") || "–"}</div>
      </td>
      <td className="px-2 py-2">
        <Link href={`/offertes/${r.id}`} className="block max-w-[260px] truncate text-xs text-[var(--color-ink-muted)] hover:underline" title={r.title}>{r.title}</Link>
        <div className="text-2xs text-[var(--color-ink-faint)]">Nr. {r.number}{r.serviceType ? ` · ${r.serviceType}` : ""}</div>
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{r.amount != null ? euro(r.amount) : <span className="text-xs text-[var(--color-ink-faint)]" title="Niet uit PandaDoc of de PDF te bevestigen">onbekend</span>}</td>
      <td className="px-2 py-2 text-xs text-[var(--color-ink-muted)]">{fmtDate(r.sentAt) ?? <span className="text-[var(--color-ink-faint)]">–</span>}</td>
      <td className="px-2 py-2"><Activity r={r} /></td>
      <td className="px-2 py-2"><StatusPill status={r.status} />{r.syncError ? <AlertTriangle className="ml-1 inline size-3.5 text-[var(--color-warn)]" aria-label={r.syncError} /> : null}</td>
      <td className="px-2 py-2"><LeadCell r={r} /></td>
      <td className="px-2 py-2 text-right">
        {r.source === "pandadoc" && r.externalId ? (
          <a href={pandadocDocumentUrl(r.externalId)} target="_blank" rel="noopener noreferrer" title="Openen in PandaDoc" className="inline-grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"><ExternalLink className="size-3.5" /></a>
        ) : null}
      </td>
    </tr>
  );
}

function MobileCard({ r }: { r: QuoteListRow }) {
  const meta = QUOTE_STATUS_META[r.status] ?? QUOTE_STATUS_META.concept!;
  return (
    <Link href={`/offertes/${r.id}`} className="block rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3" style={{ boxShadow: `inset 3px 0 0 ${meta.color}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-[var(--color-ink)]">{customer(r)}</div>
          <div className="truncate text-2xs text-[var(--color-ink-faint)]">{r.title}</div>
        </div>
        <div className="shrink-0 text-right text-sm font-semibold tabular-nums">{r.amount != null ? euro(r.amount) : <span className="text-xs font-normal text-[var(--color-ink-faint)]">onbekend</span>}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusPill status={r.status} />
        <Activity r={r} />
      </div>
    </Link>
  );
}

function SyncBar({ sync }: { sync: SyncInfo }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const run = () => start(async () => {
    const res = await syncPandaDocNow(false);
    setMsg({ ok: res.ok, text: res.message ?? "" });
    router.refresh();
  });

  const at = sync.at ? new Date(sync.at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const problem = !sync.configured || !sync.ok;

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border px-3 py-2 text-xs ${problem ? "border-[color-mix(in_srgb,var(--color-bad)_35%,transparent)] bg-[var(--color-bad-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}>
      <FileSignature className={`size-4 ${problem ? "text-[var(--color-bad)]" : "text-[var(--color-good)]"}`} />
      <span className="min-w-0 flex-1">
        {!sync.configured ? (
          <span className="font-semibold text-[var(--color-bad)]">PandaDoc is nog niet gekoppeld. De offertes hieronder worden niet bijgewerkt.</span>
        ) : !sync.ok ? (
          <span><span className="font-semibold text-[var(--color-bad)]">Synchronisatie met PandaDoc mislukt{at ? ` (${at})` : ""}.</span> {sync.message}</span>
        ) : (
          <span className="text-[var(--color-ink-muted)]">Gekoppeld met PandaDoc. PandaDoc is leidend; alles wordt automatisch bijgewerkt.{at ? ` Laatst bijgewerkt ${at}.` : ""}</span>
        )}
        {msg ? <span className={`ml-2 font-semibold ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</span> : null}
      </span>
      {sync.configured ? (
        <button type="button" onClick={run} disabled={pending} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1 font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-60">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Nu bijwerken
        </button>
      ) : null}
    </div>
  );
}
