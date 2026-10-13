"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ShieldCheck, Loader2 } from "lucide-react";
import { Card } from "@/components/ui";
import { setQcCheck } from "@/server/actions/qc";
import type { QcItem } from "@/server/qc";

export function QcPanel({ items, canWrite }: { items: QcItem[]; canWrite: boolean }) {
  const [list, setList] = useState(items);
  const [pending, start] = useTransition();
  const router = useRouter();

  const done = list.filter((i) => i.done).length;
  const total = list.length;
  const complete = total > 0 && done === total;

  function toggle(id: string, next: boolean) {
    if (!canWrite) return;
    setList((xs) => xs.map((i) => (i.id === id ? { ...i, done: next } : i))); // optimistisch
    start(async () => {
      const res = await setQcCheck(id, next);
      if (!res.ok) {
        setList((xs) => xs.map((i) => (i.id === id ? { ...i, done: !next } : i)));
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-[var(--color-brand-600)]" />
          Kwaliteitscontrole
        </h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            complete ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-warn-soft)] text-[#8a5300]"
          }`}
        >
          {done}/{total}{complete ? " · compleet" : ""}
        </span>
      </div>

      {!complete ? (
        <p className="mb-2 text-2xs text-[var(--color-ink-muted)]">Loop deze punten na vóór je de video naar de klant stuurt.</p>
      ) : null}

      <ul className="space-y-1.5">
        {list.map((i) => (
          <li key={i.id}>
            <label className={`flex items-start gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1 ${canWrite ? "cursor-pointer hover:bg-[var(--color-surface-sunken)]" : ""}`}>
              <span
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border ${
                  i.done ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)]"
                }`}
              >
                {i.done ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={i.done}
                disabled={!canWrite || pending}
                onChange={(e) => toggle(i.id, e.target.checked)}
              />
              <span className={`text-sm ${i.done ? "text-[var(--color-ink-faint)] line-through" : "text-[var(--color-ink)]"}`}>{i.label}</span>
            </label>
          </li>
        ))}
      </ul>

      {pending ? <div className="mt-2 flex items-center gap-1.5 text-2xs text-[var(--color-ink-faint)]"><Loader2 className="size-3 animate-spin" /> opslaan…</div> : null}
    </Card>
  );
}
