"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Check, Loader2 } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { setTaskStatus } from "@/server/actions/tasks";

type Tone = "bad" | "warn" | "good" | "neutral";
export type TodoLine = { taskId: string; what: string; action: string; meta: string; tone: Tone };

const DOT: Record<Tone, string> = {
  bad: "bg-[var(--color-bad)]",
  warn: "bg-[var(--color-warn)]",
  good: "bg-[var(--color-good)]",
  neutral: "bg-[var(--color-ink-faint)]",
};
const META: Record<Tone, string> = {
  bad: "text-[var(--color-bad)]",
  warn: "text-[var(--color-warn)]",
  good: "text-[var(--color-good)]",
  neutral: "text-[var(--color-ink-muted)]",
};

/**
 * "Mijn to-do" op het Vandaag-dashboard — dezelfde taken als de takenpagina,
 * hier direct afvinkbaar. Afvinken zet de taak op "done" (setTaskStatus) net als
 * op /tasks, dus beide plekken blijven gelijk.
 */
export function TodoCard({ lines, empty }: { lines: TodoLine[]; empty: string }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();

  const complete = (id: string) => {
    if (busy) return;
    setBusy(id);
    setDone((s) => new Set(s).add(id)); // optimistisch afstrepen
    start(async () => {
      await setTaskStatus(id, "done");
      router.refresh();
      setBusy(null);
    });
  };

  const openCount = lines.filter((l) => !done.has(l.taskId)).length;

  return (
    <Card padded={false} className="overflow-hidden ring-1 ring-[var(--color-brand-600)]/20">
      <div className="flex items-center gap-2.5 bg-[var(--color-brand-600)] px-5 py-3 text-white">
        <ListChecks className="size-5 shrink-0 opacity-90" />
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold tracking-tight">Mijn to-do</h2>
          <p className="truncate text-xs text-white/70">Jouw taken van de takenpagina — hier direct af te vinken.</p>
        </div>
        {openCount > 0 ? <span className="ml-auto shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-semibold">{openCount}</span> : null}
      </div>
      {lines.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {lines.map((l) => {
            const isDone = done.has(l.taskId);
            return (
              <li key={l.taskId} className={`flex items-center gap-3 px-5 py-3 ${isDone ? "opacity-50" : ""}`}>
                <button
                  type="button"
                  onClick={() => complete(l.taskId)}
                  disabled={isDone}
                  title="Afvinken"
                  className={`grid size-5 shrink-0 place-items-center rounded-[6px] border transition ${isDone ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)] hover:border-[var(--color-good)]"}`}
                >
                  {busy === l.taskId ? <Loader2 className="size-3.5 animate-spin" /> : isDone ? <Check className="size-3.5" /> : null}
                </button>
                <Link href="/tasks" className="flex min-w-0 flex-1 items-center gap-3">
                  <span className={`size-2.5 shrink-0 rounded-full ${DOT[l.tone]}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-medium ${isDone ? "line-through" : ""}`}>{l.what}</span>
                    <span className="block truncate text-xs text-[var(--color-ink-muted)]">{l.action}</span>
                  </span>
                  {l.meta ? <span className={`shrink-0 text-xs font-semibold ${META[l.tone]}`}>{l.meta}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
