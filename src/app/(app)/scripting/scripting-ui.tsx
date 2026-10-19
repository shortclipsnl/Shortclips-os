"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Loader2 } from "lucide-react";
import { setScriptingStatus, setScriptWriter } from "@/server/actions/scripting";
import { SCRIPTING_ORDER, SCRIPTING_STATUS } from "@/lib/statuses";
import { Avatar, ClientLogo } from "@/components/ui";
import type { ScriptingRow, WriterOption } from "@/server/scripting";

const FILTERS = [
  { key: "alle", label: "Alle aankomend" },
  { key: "niet-afgerond", label: "Nog niet afgerond" },
  { key: "deze-week", label: "Deze week" },
  { key: "volgende-week", label: "Volgende week" },
  { key: "nadert", label: "Deadline nadert" },
  { key: "te-laat", label: "Te laat" },
  { key: "afgerond", label: "Afgerond" },
] as const;

const STATUS_PILL: Record<string, string> = {
  afstemmen: "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]",
  concepting: "bg-[var(--color-info-soft)] text-[#0060a8]",
  klaar_shortclips: "bg-[var(--color-lime-soft)] text-[#54700a]",
  scriptmeeting: "bg-[var(--color-warn-soft)] text-[#8a5300]",
  final: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
};

/** Volle accentkleur per status, voor de rand van de actieve knop. */
const STATUS_ACCENT: Record<string, string> = {
  afstemmen: "var(--color-ink-faint)",
  concepting: "var(--color-info)",
  klaar_shortclips: "var(--color-lime)",
  scriptmeeting: "var(--color-warn)",
  final: "var(--color-good)",
};

/** Korte labels voor de knoppen (de volledige labels zijn soms lang). */
const STATUS_SHORT: Record<string, string> = {
  afstemmen: "Afstemmen",
  concepting: "Concepting",
  klaar_shortclips: "Klaar",
  scriptmeeting: "Scriptmeeting",
  final: "Final",
};

/** Opname-week t.o.v. nu, voor de groepering. */
function weekBucket(days: number): { order: number; label: string } {
  if (days <= 7) return { order: 1, label: "Deze week" };
  if (days <= 14) return { order: 2, label: "Volgende week" };
  if (days <= 21) return { order: 3, label: "Over twee weken" };
  return { order: 4, label: "Later" };
}

/** Volle kleur per week-kop, zodat je van week naar week kunt scannen. */
const WEEK_COLOR: Record<number, string> = {
  1: "var(--color-brand-600)",
  2: "var(--color-info)",
  3: "var(--color-violet)",
  4: "var(--color-ink-muted)",
};

function fmt(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/** Afteller-tekst tot de scriptingdeadline. */
function countdown(r: ScriptingRow): string {
  if (r.done) return "Afgerond";
  const d = r.daysToDeadline;
  if (d < 0) return `${Math.abs(d)} dag${Math.abs(d) === 1 ? "" : "en"} te laat`;
  if (d === 0) return "Vandaag deadline";
  if (d === 1) return "Morgen deadline";
  return `Nog ${d} dagen`;
}
const FLAG_COLOR: Record<string, string> = {
  green: "var(--color-good)",
  amber: "var(--color-warn)",
  red: "var(--color-bad)",
  done: "var(--color-good)",
};

export function ScriptingBoard({ rows, clientOptions, writerOptions, canWrite, defaultFilter }: { rows: ScriptingRow[]; clientOptions: string[]; writerOptions: WriterOption[]; canWrite: boolean; defaultFilter?: string }) {
  const [filter, setFilter] = useState<string>(FILTERS.some((f) => f.key === defaultFilter) ? defaultFilter! : "alle");
  const [status, setStatus] = useState<string>("alle");
  const [client, setClient] = useState<string>("alle");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "niet-afgerond" && r.done) return false;
      if (filter === "deze-week" && !(r.daysToShoot >= 0 && r.daysToShoot <= 7)) return false;
      if (filter === "volgende-week" && !(r.daysToShoot > 7 && r.daysToShoot <= 14)) return false;
      if (filter === "nadert" && !(r.flag === "amber")) return false;
      if (filter === "te-laat" && r.flag !== "red") return false;
      if (filter === "afgerond" && !r.done) return false;
      if (status !== "alle" && r.status !== status) return false;
      if (client !== "alle" && r.clientName !== client) return false;
      return true;
    });
  }, [rows, filter, status, client]);

  // Per week groeperen (deze week / volgende week / ...), gesorteerd op opnamedag.
  const groups = useMemo(() => {
    const m = new Map<number, { order: number; label: string; rows: ScriptingRow[] }>();
    for (const r of filtered) {
      const b = weekBucket(r.daysToShoot);
      const g = m.get(b.order) ?? { ...b, rows: [] };
      g.rows.push(r);
      m.set(b.order, g);
    }
    return [...m.values()]
      .sort((a, b) => a.order - b.order)
      .map((g) => ({ ...g, rows: [...g.rows].sort((x, y) => x.daysToShoot - y.daysToShoot) }));
  }, [filtered]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.key ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="sc-input h-8 w-auto py-0 text-xs" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Scriptingstatus">
            <option value="alle">Alle statussen</option>
            {SCRIPTING_ORDER.map((s) => <option key={s} value={s}>{SCRIPTING_STATUS[s]!.label}</option>)}
          </select>
          <select className="sc-input h-8 w-auto py-0 text-xs" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Klant">
            <option value="alle">Alle klanten</option>
            {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-2 text-xs text-[var(--color-ink-faint)]">{filtered.length} van {rows.length} opnames</div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] text-left text-xs text-[var(--color-ink-faint)]">
              <th className="px-3 py-2 font-medium">Klant</th>
              <th className="px-2 py-2 font-medium">Opname</th>
              <th className="px-2 py-2 font-medium">Scriptdeadline</th>
              <th className="px-2 py-2 font-medium">Afteller</th>
              <th className="px-2 py-2 font-medium">Verantwoordelijke</th>
              <th className="px-2 py-2 font-medium">Scriptingstatus</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => (
              <Fragment key={g.label}>
                {/* Ruimte tussen de weekgroepen, zodat het beter scanbaar is. */}
                {gi > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={6} className="h-6 bg-[var(--color-surface)]" />
                  </tr>
                ) : null}
                {/* Week-kop in volle kleur, zodat je van week naar week kunt scannen. */}
                <tr>
                  <td colSpan={6} className="p-0">
                    <div
                      className="flex items-center gap-2 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-white"
                      style={{ background: WEEK_COLOR[g.order] ?? "var(--color-ink-muted)" }}
                    >
                      {g.label}
                      <span className="rounded-full bg-white/25 px-2 py-0.5 text-2xs font-bold normal-case tabular-nums">{g.rows.length}</span>
                    </div>
                  </td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-line)] hover:bg-[var(--color-surface-sunken)]/40"
                    style={{ boxShadow: `inset 3px 0 0 ${FLAG_COLOR[r.flag]}` }}>
                    <td className="px-3 py-2">
                      <Link href={`/productions/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <ClientLogo name={r.clientName} logoUrl={r.clientLogo} color={r.clientColor} size={22} />
                        {r.clientName}
                      </Link>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{fmt(r.scheduledOn)}</td>
                    <td className="px-2 py-2 tabular-nums text-[var(--color-ink-muted)]">{fmt(r.deadline)}</td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: FLAG_COLOR[r.flag] }}>
                        <span className="size-2 rounded-full" style={{ background: FLAG_COLOR[r.flag] }} />
                        {countdown(r)}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <WriterCell id={r.id} writerId={r.scriptWriterId} writerName={r.scriptWriterName} options={writerOptions} canWrite={canWrite} urgent={!r.done && r.daysToDeadline <= 7} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <StatusPicker id={r.id} status={r.status} canWrite={canWrite} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {groups.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--color-ink-faint)]">Geen opnames met deze filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Verantwoordelijke scriptschrijver kiezen (Milou/Jiska/Jarno). Niet toegewezen
 * valt op in oranje, zodat meteen duidelijk is wie het script nog moet oppakken.
 */
function WriterCell({ id, writerId, writerName, options, canWrite, urgent }: { id: string; writerId: string | null; writerName: string | null; options: WriterOption[]; canWrite: boolean; urgent: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!canWrite) {
    return writerName ? (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <Avatar name={writerName} size={20} />
        {writerName.split(" ")[0]}
      </span>
    ) : (
      <span className="text-xs text-[var(--color-ink-faint)]">—</span>
    );
  }

  const change = (next: string) => {
    start(async () => { await setScriptWriter(id, next || null); router.refresh(); });
  };
  // Alleen oranje waarschuwen als er niemand staat én de deadline nadert
  // (binnen 7 dagen). Anders een rustige grijze placeholder — zo valt het
  // urgente écht op i.p.v. dat alles een waarschuwing is.
  const warn = !writerId && urgent;

  return (
    <span className="inline-flex items-center gap-1.5">
      {writerName ? <Avatar name={writerName} size={20} /> : null}
      <select
        value={writerId ?? ""}
        onChange={(e) => change(e.target.value)}
        disabled={pending}
        aria-label="Verantwoordelijke"
        className={`h-7 min-w-[120px] rounded-full border-0 py-0 pl-2.5 pr-6 text-xs font-semibold ${warn ? "bg-[var(--color-warn-soft)]/60 text-[#8a5300]" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}
      >
        <option value="">{warn ? "⚠ Wie schrijft dit?" : "Wie schrijft dit?"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.fullName.split(" ")[0]}</option>
        ))}
      </select>
      {pending ? <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" /> : null}
    </span>
  );
}

/**
 * Gekleurde statuskiezer: de huidige status staat als grote gekleurde pil; bij
 * klikken klappen de opties (ook gekleurd, groter) eronder uit — zo ziet het
 * team in één oogopslag de status en kan het met één klik wisselen.
 */
function StatusPicker({ id, status, canWrite }: { id: string; status: string; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(status);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const meta = SCRIPTING_STATUS[val] ?? SCRIPTING_STATUS.afstemmen!;

  const choose = (v: string) => {
    setVal(v);
    setOpen(false);
    start(async () => { await setScriptingStatus(id, v); router.refresh(); });
  };

  if (!canWrite) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${STATUS_PILL[val]}`}>
        <span className="size-2 rounded-full" style={{ background: STATUS_ACCENT[val] }} />
        {STATUS_SHORT[val] ?? meta.label}
      </span>
    );
  }

  return (
    <div className="min-w-[150px]">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={pending}
        title={meta.label}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${STATUS_PILL[val]}`}
        style={open ? { boxShadow: `0 0 0 2px ${STATUS_ACCENT[val]}` } : undefined}>
        <span className="size-2 rounded-full" style={{ background: STATUS_ACCENT[val] }} />
        {STATUS_SHORT[val] ?? meta.label}
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronDown className="size-3.5 opacity-60" />}
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SCRIPTING_ORDER.map((s) => (
            <button key={s} type="button" onClick={() => choose(s)} title={SCRIPTING_STATUS[s]!.label}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${STATUS_PILL[s]} ${s === val ? "" : "opacity-75 hover:opacity-100"}`}
              style={s === val ? { boxShadow: `0 0 0 2px ${STATUS_ACCENT[s]}` } : undefined}>
              <span className="size-2 rounded-full" style={{ background: STATUS_ACCENT[s] }} />
              {STATUS_SHORT[s]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
