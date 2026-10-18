"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, X } from "lucide-react";
import { cancelLeave, requestLeave, reviewLeave, setLeaveHours } from "@/server/actions/leave";
import { Button, ErrorNote, TeamAvatar } from "@/components/ui";

const KINDS = ["vakantie", "vrije dag", "ziek", "bijzonder verlof"] as const;

export type Balance = {
  userId: string;
  name: string;
  isStaff: boolean;
  totalHours: number;
  takenHours: number;
  remainingHours: number;
  requests: number;
};

/** Vakantiesaldo per teamlid op uren: opgenomen vs beschikbaar, met wat er over
 *  is. De eigenaar kan het contracttotaal per persoon inline aanpassen. */
export function LeaveBalances({ balances, canEdit }: { balances: Balance[]; canEdit: boolean }) {
  if (balances.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {balances.map((b) => <BalanceCard key={b.userId} b={b} canEdit={canEdit} />)}
    </div>
  );
}

function BalanceCard({ b, canEdit }: { b: Balance; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [hours, setHours] = useState(String(b.totalHours));
  const router = useRouter();
  const pctUsed = b.totalHours > 0 ? Math.min(100, Math.round((b.takenHours / b.totalHours) * 100)) : 0;
  const low = b.remainingHours <= b.totalHours * 0.15;

  function saveHours() {
    const h = Number(hours);
    if (!Number.isFinite(h) || h === b.totalHours) return;
    start(async () => { await setLeaveHours(b.userId, h); router.refresh(); });
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-3">
        <TeamAvatar name={b.name} size={48} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{b.name}</span>
        <span className="shrink-0 rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-2xs font-medium text-[#0060a8]">Vast</span>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className={`text-2xl font-bold tabular-nums ${low ? "text-[var(--color-bad)]" : "text-[var(--color-ink)]"}`}>{b.remainingHours}<span className="text-sm font-medium text-[var(--color-ink-faint)]"> u over</span></div>
          <div className="text-2xs text-[var(--color-ink-muted)]">{b.takenHours} u opgenomen · {b.requests} aanvra{b.requests === 1 ? "ag" : "gen"}</div>
        </div>
      </div>
      <div className="mt-2 h-2 rounded-full bg-[var(--color-surface-2)]">
        <div className={`h-full rounded-full ${low ? "bg-[var(--color-bad)]" : pctUsed > 70 ? "bg-[var(--color-warn)]" : "bg-[var(--color-good)]"}`} style={{ width: `${pctUsed}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-2xs text-[var(--color-ink-faint)]">
        {canEdit ? (
          <span className="inline-flex items-center gap-1">
            <input type="number" value={hours} onChange={(e) => setHours(e.target.value)} onBlur={saveHours}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="h-6 w-16 rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1.5 text-right text-xs tabular-nums" />
            <span>u/jaar{pending ? " …" : ""}</span>
          </span>
        ) : <span>{b.totalHours} u per jaar</span>}
      </div>
    </div>
  );
}

export function RequestLeaveForm() {
  const [startOn, setStart] = useState("");
  const [endOn, setEnd] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("vakantie");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setErr(null);
    start(async () => {
      const res = await requestLeave({ startOn, endOn, kind, note });
      if (res.ok) {
        setStart(""); setEnd(""); setNote("");
        router.refresh();
      } else setErr(res.message ?? "Mislukt");
    });
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="sc-label">Van</label>
          <input type="date" className="sc-input" value={startOn} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="sc-label">Tot en met</label>
          <input type="date" className="sc-input" value={endOn} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div>
          <label className="sc-label">Soort</label>
          <select className="sc-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label className="sc-label">Toelichting (optioneel)</label>
          <input className="sc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="bijv. lang weekend" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={submit} disabled={pending || !startOn || !endOn} size="sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Verlof aanvragen
        </Button>
        {err ? <ErrorNote>{err}</ErrorNote> : null}
      </div>
    </div>
  );
}

export function ReviewButtons({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (d: "approved" | "rejected") => start(async () => { await reviewLeave(id, d); router.refresh(); });
  return (
    <span className="flex shrink-0 gap-1.5">
      <button type="button" disabled={pending} onClick={() => run("approved")}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-good)] px-2.5 py-1 text-xs font-medium text-white hover:brightness-95">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Goedkeuren
      </button>
      <button type="button" disabled={pending} onClick={() => run("rejected")}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
        <X className="size-3.5" /> Afwijzen
      </button>
    </span>
  );
}

export function CancelButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button type="button" disabled={pending}
      onClick={() => start(async () => { await cancelLeave(id); router.refresh(); })}
      className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Intrekken">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
    </button>
  );
}
