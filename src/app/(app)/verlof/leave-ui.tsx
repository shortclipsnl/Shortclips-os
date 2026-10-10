"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, X } from "lucide-react";
import { cancelLeave, requestLeave, reviewLeave } from "@/server/actions/leave";
import { Button, ErrorNote } from "@/components/ui";

const KINDS = ["vakantie", "vrije dag", "ziek", "bijzonder verlof"] as const;

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
