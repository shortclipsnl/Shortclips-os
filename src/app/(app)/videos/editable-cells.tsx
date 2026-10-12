"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { assignEditor, changeVideoStatus, setVideoDeadline } from "@/server/actions/videos";
import { VIDEO_STATUS, type VideoStage } from "@/lib/statuses";

export type EditorOption = { id: string; fullName: string };

const STATUS_ENTRIES = Object.entries(VIDEO_STATUS) as [VideoStage, { label: string }][];

function useSaver() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setErr(null);
      const res = await fn();
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Mislukt");
    });
  return { pending, err, run };
}

/** Fase/status wijzigen vanuit de lijst. */
export function StatusCell({ id, status }: { id: string; status: string }) {
  const { pending, err, run } = useSaver();
  return (
    <span className="inline-flex items-center gap-1" title={err ?? undefined}>
      <select
        className="sc-input h-7 w-40 py-0 text-xs"
        value={status}
        disabled={pending}
        onChange={(e) => run(() => changeVideoStatus(id, e.target.value))}
      >
        {STATUS_ENTRIES.map(([key, s]) => (
          <option key={key} value={key}>{s.label}</option>
        ))}
      </select>
      {pending ? <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" /> : null}
      {err ? <span className="text-2xs text-[var(--color-bad)]">!</span> : null}
    </span>
  );
}

/** Editor kiezen/wisselen vanuit de lijst. */
export function EditorCell({ id, editorId, editors }: { id: string; editorId: string | null; editors: EditorOption[] }) {
  const { pending, err, run } = useSaver();
  return (
    <span className="inline-flex items-center gap-1" title={err ?? undefined}>
      <select
        className="sc-input h-7 w-36 py-0 text-xs"
        value={editorId ?? ""}
        disabled={pending}
        onChange={(e) => run(() => assignEditor(id, e.target.value || null))}
      >
        <option value="">— Geen editor —</option>
        {editors.map((ed) => (
          <option key={ed.id} value={ed.id}>{ed.fullName}</option>
        ))}
      </select>
      {pending ? <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" /> : null}
      {err ? <span className="text-2xs text-[var(--color-bad)]">!</span> : null}
    </span>
  );
}

/** Deadline zetten/wissen vanuit de lijst. */
export function DeadlineCell({ id, dueOn, overdue }: { id: string; dueOn: string | null; overdue: boolean }) {
  const { pending, err, run } = useSaver();
  const [val, setVal] = useState(dueOn ?? "");
  return (
    <span className="inline-flex items-center gap-1" title={err ?? undefined}>
      <input
        type="date"
        className={`sc-input h-7 w-32 py-0 text-xs ${overdue ? "font-semibold text-[var(--color-bad)]" : ""}`}
        value={val}
        disabled={pending}
        onChange={(e) => { setVal(e.target.value); run(() => setVideoDeadline(id, e.target.value || null)); }}
      />
      {pending ? <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" /> : null}
      {err ? <span className="text-2xs text-[var(--color-bad)]">!</span> : null}
    </span>
  );
}
