"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, ArrowRightCircle, Check, FolderOpen, Loader2, Plus, Search, Trophy, Users, XCircle } from "lucide-react";
import { convertLeadToClient, createLead, setLeadFollowUp, setLeadSource, setLeadStatus } from "@/server/actions/leads";
import type { LeadRow } from "@/server/leads";
import { LEAD_STATUS } from "@/lib/statuses";
import { Stat } from "@/components/ui";

/** Het jaar waar een lead bij hoort: de jaargang (Monday-groep, bijv. "2026")
 *  als die er is, anders het jaar van de eerste contactdatum. Zo vallen ook
 *  nieuwe leads (zonder jaargang) in het juiste jaar. */
function leadYear(r: LeadRow): string | null {
  if (r.segment && /^\d{4}$/.test(r.segment.trim())) return r.segment.trim();
  if (r.firstContactOn) return r.firstContactOn.slice(0, 4);
  return null;
}

/** Vaste bronnen met een eigen kleur, zodat ze goed herkenbaar zijn. */
// Elke bron een eigen, duidelijke kleur — inclusief de bronnen die echt in de
// data voorkomen (Rocket leads, Website, Onbekend). Onbekende/nieuwe bronnen
// krijgen via een hash alsnog een vaste, eigen kleur.
const LEAD_SOURCES: { value: string; color: string }[] = [
  { value: "Rocket leads", color: "#7c5cff" },
  { value: "Meta advertentiecampagne", color: "#1877F2" },
  { value: "Website", color: "#2f9e44" },
  { value: "Netwerk", color: "#f2843b" },
  { value: "LinkedIn", color: "#5b9bf0" },
  { value: "Social media", color: "#d6336c" },
  { value: "Mail", color: "#0f766e" },
  { value: "Onbekend", color: "#8a94a6" },
];
const SOURCE_FALLBACK = ["#1098ad", "#e8590c", "#9c36b5", "#2b8a3e", "#c2255c", "#1864ab", "#5f3dc4", "#087f5b"];
function sourceColor(s: string | null | undefined): string {
  const key = (s ?? "").trim().toLowerCase();
  if (!key) return "var(--color-ink-faint)";
  const hit = LEAD_SOURCES.find((x) => x.value.toLowerCase() === key);
  if (hit) return hit.color;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SOURCE_FALLBACK[h % SOURCE_FALLBACK.length]!;
}

/** Snel een nieuwe lead toevoegen (handmatig, naast de webhook-intake). */
export function QuickAddLead() {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [src, setSrc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!company.trim()) return;
    start(async () => {
      const res = await createLead({ company, contactName: contact || undefined, email: email || undefined, phone: phone || undefined, source: src || undefined });
      if (res.ok) { setCompany(""); setContact(""); setEmail(""); setPhone(""); setSrc(""); setErr(null); setOpen(false); router.refresh(); }
      else setErr(res.message ?? "Mislukt");
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mb-4 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
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
      <select className="sc-input h-8 w-auto py-0 text-sm" value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Bron">
        <option value="">Bron…</option>
        {LEAD_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
      </select>
      <button type="button" onClick={add} disabled={pending || !company.trim()}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
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

const OPEN_SET = new Set(["lead", "offerte", "onderhandeling"]);

export function LeadsBoard({ rows, sources }: { rows: LeadRow[]; sources: string[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = String(new Date().getFullYear());

  // Beschikbare jaargangen (jaargang óf jaar van eerste contact), nieuwste eerst.
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) { const y = leadYear(r); if (y) set.add(y); }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [rows]);

  // Standaard tonen we het lopende jaar (bijv. 2026) — niet alles. Is er voor dit
  // jaar nog niets, dan het nieuwste jaar met leads.
  const [year, setYear] = useState<string>(() => (years.includes(currentYear) ? currentYear : (years[0] ?? "alle")));
  const [status, setStatus] = useState<string>("open");
  const [source, setSource] = useState<string>("alle");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  // Rijen van de gekozen jaargang — basis voor zowel de tegels als de tabel.
  const yearRows = useMemo(
    () => (year === "alle" ? rows : rows.filter((r) => leadYear(r) === year)),
    [rows, year],
  );

  // Tegel-tellingen volgen de gekozen jaargang, zodat de cijfers kloppen.
  const counts = useMemo(() => ({
    total: yearRows.length,
    open: yearRows.filter((r) => OPEN_SET.has(r.status)).length,
    overdue: yearRows.filter((r) => OPEN_SET.has(r.status) && r.followUpOn && r.followUpOn <= today).length,
    won: yearRows.filter((r) => r.status === "gewonnen").length,
    lost: yearRows.filter((r) => r.status === "verloren").length,
  }), [yearRows, today]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return yearRows.filter((r) => {
      if (status === "open") { if (!OPEN_SET.has(r.status)) return false; }
      else if (status === "overdue") { if (!(OPEN_SET.has(r.status) && r.followUpOn && r.followUpOn <= today)) return false; }
      else if (status !== "alle" && r.status !== status) return false;
      if (source !== "alle" && r.source !== source) return false;
      // Datumfilter op binnenkomstdatum (firstContactOn).
      if (from || to) {
        const d = r.firstContactOn;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      if (needle) {
        const hay = `${r.company} ${r.contactName ?? ""} ${r.email ?? ""} ${r.phone ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [yearRows, status, source, from, to, q, today]);

  return (
    <div>
      {/* Klikbare statustegels — filteren de lijst direct op die status. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Totaal" value={String(counts.total)} icon={<Users />} onClick={() => setStatus("alle")} active={status === "alle"} />
        <Stat label="Open" value={String(counts.open)} hint="lead/offerte/onderhandeling" tone="info" icon={<FolderOpen />} onClick={() => setStatus("open")} active={status === "open"} />
        <Stat label="Te laat op te volgen" value={String(counts.overdue)} tone={counts.overdue > 0 ? "bad" : "good"} icon={<AlarmClock />} emphasis={counts.overdue > 0} hint={counts.overdue > 0 ? "direct opvolgen" : undefined} onClick={() => setStatus("overdue")} active={status === "overdue"} />
        <Stat label="Gewonnen" value={String(counts.won)} tone="good" icon={<Trophy />} onClick={() => setStatus("gewonnen")} active={status === "gewonnen"} />
        <Stat label="Verloren" value={String(counts.lost)} tone="warn" icon={<XCircle />} onClick={() => setStatus("verloren")} active={status === "verloren"} />
      </div>

      {/* Jaargang: standaard het lopende jaar (bijv. 2026), met knoppen voor
          eerdere jaren en "Alle jaren". Niet standaard alles tonen. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Jaargang</span>
        {years.map((y) => (
          <button key={y} type="button" onClick={() => setYear(y)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${year === y ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
            {y}
          </button>
        ))}
        <button type="button" onClick={() => setYear("alle")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${year === "alle" ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
          Alle jaren
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {(["open", "lead", "offerte", "onderhandeling", "gewonnen", "verloren", "alle"] as const).map((s) => {
            const meta = LEAD_STATUS[s];
            const label = s === "open" ? "Open" : s === "alle" ? "Alle" : meta?.label ?? s;
            return (
              <button key={s} type="button" onClick={() => setStatus(s)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${status === s ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]"}`}>
                {meta ? <span className="size-2 rounded-full" style={{ background: meta.dot }} /> : null}
                {label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Datumfilter op binnenkomstdatum. */}
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)]">
            <span className="text-[var(--color-ink-faint)]">Datum</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 bg-transparent text-xs outline-none" aria-label="Van" title="Vanaf" />
            <span className="text-[var(--color-ink-faint)]">–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-7 bg-transparent text-xs outline-none" aria-label="Tot" title="Tot en met" />
            {from || to ? <button type="button" onClick={() => { setFrom(""); setTo(""); }} className="text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" title="Datumfilter wissen">×</button> : null}
          </span>
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

      <div className="mb-2 text-xs text-[var(--color-ink-faint)]">{filtered.length} van {yearRows.length} leads{year === "alle" ? "" : ` in ${year}`}</div>

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
      <td className="px-2 py-2"><SourceCell id={r.id} source={r.source} /></td>
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

/** Bewerkbare, gekleurde bron per lead. */
function SourceCell({ id, source }: { id: string; source: string | null }) {
  const [val, setVal] = useState(source ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const inList = LEAD_SOURCES.some((s) => s.value.toLowerCase() === val.toLowerCase());
  const color = sourceColor(val || null);

  function change(next: string) {
    setVal(next);
    start(async () => { await setLeadSource({ id, source: next || null }); router.refresh(); });
  }

  return (
    <span className="relative inline-flex items-center">
      <span className="mr-1.5 size-2 shrink-0 rounded-full" style={{ background: color }} />
      <select value={val} onChange={(e) => change(e.target.value)} disabled={pending}
        className="max-w-[150px] cursor-pointer appearance-none rounded-full py-1 pl-2 pr-5 text-xs font-semibold"
        style={{ background: `color-mix(in srgb, ${color} 20%, var(--color-surface))`, color: val ? color : "var(--color-ink-muted)", boxShadow: val ? `inset 0 0 0 1px color-mix(in srgb, ${color} 45%, transparent)` : undefined }}>
        <option value="">Bron kiezen…</option>
        {LEAD_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
        {val && !inList ? <option value={val}>{val}</option> : null}
      </select>
      {pending ? <Loader2 className="pointer-events-none absolute right-1 size-3 animate-spin opacity-60" /> : null}
    </span>
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
