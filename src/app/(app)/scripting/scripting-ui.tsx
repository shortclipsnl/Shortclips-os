"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { setScriptingStatus } from "@/server/actions/scripting";
import { SCRIPTING_ORDER, SCRIPTING_STATUS } from "@/lib/statuses";
import { Avatar } from "@/components/ui";
import type { ScriptingRow } from "@/server/scripting";

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

export function ScriptingBoard({ rows, clientOptions, canWrite, defaultFilter }: { rows: ScriptingRow[]; clientOptions: string[]; canWrite: boolean; defaultFilter?: string }) {
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.key ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>
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
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] text-left text-xs text-[var(--color-ink-faint)]">
              <th className="px-3 py-2 font-medium">Klant</th>
              <th className="px-2 py-2 font-medium">Opname</th>
              <th className="px-2 py-2 font-medium">Scriptdeadline</th>
              <th className="px-2 py-2 font-medium">Afteller</th>
              <th className="px-2 py-2 font-medium">Scriptingstatus</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-surface-sunken)]/40"
                style={{ boxShadow: `inset 3px 0 0 ${FLAG_COLOR[r.flag]}` }}>
                <td className="px-3 py-2">
                  <Link href={`/productions/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <Avatar name={r.clientName} color={r.clientColor} size={22} />
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
                <td className="px-2 py-2">
                  <StatusCell id={r.id} status={r.status} canWrite={canWrite} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-[var(--color-ink-faint)]">Geen opnames met deze filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusCell({ id, status, canWrite }: { id: string; status: string; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(status);
  const router = useRouter();
  const meta = SCRIPTING_STATUS[val] ?? SCRIPTING_STATUS.afstemmen!;

  if (!canWrite) {
    return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_PILL[val]}`}>{meta.label}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={val}
        disabled={pending}
        onChange={(e) => { const v = e.target.value; setVal(v); start(async () => { await setScriptingStatus(id, v); router.refresh(); }); }}
        className={`appearance-none rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_PILL[val]} cursor-pointer`}
      >
        {SCRIPTING_ORDER.map((s) => <option key={s} value={s}>{SCRIPTING_STATUS[s]!.label}</option>)}
      </select>
      {pending ? <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" /> : null}
    </span>
  );
}
