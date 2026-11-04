"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { togglePublicationCheck } from "@/server/actions/publication-checks";
import { cn } from "@/lib/cn";

type Item = { id: string; label: string; done: boolean; doneByName: string | null };

/**
 * Publicatie-checklist op de videopagina — voor het publicatieteam (o.a. Milou,
 * Jiska) om ná publicatie na te lopen of alles goed is uitgevoerd.
 */
export function PublicationChecklistPanel({ items, canEdit }: { items: Item[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = total > 0 && done === total;

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <CheckCircle2 className={cn("size-4", allDone ? "text-[var(--color-good)]" : "text-[var(--color-ink-muted)]")} />
        <h3 className="text-sm font-semibold text-[var(--color-ink)]">Publicatiecheck</h3>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums",
            allDone ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]",
          )}
        >
          {done}/{total}
        </span>
      </header>
      <ul className="divide-y divide-[var(--color-line)]">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              checked={it.done}
              disabled={!canEdit || pending}
              onChange={() =>
                start(async () => {
                  const r = await togglePublicationCheck(it.id);
                  if (r.ok) router.refresh();
                })
              }
              className="size-4 shrink-0 accent-[var(--color-brand-500)]"
              aria-label={it.label}
            />
            <span className={cn("min-w-0 flex-1 text-sm", it.done && "text-[var(--color-ink-faint)] line-through")}>{it.label}</span>
            {it.done && it.doneByName ? (
              <span className="shrink-0 text-2xs text-[var(--color-ink-faint)]">{it.doneByName.split(" ")[0]}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {!canEdit ? (
        <p className="px-4 py-2 text-2xs text-[var(--color-ink-faint)]">Alleen het publicatieteam kan dit afvinken.</p>
      ) : null}
    </section>
  );
}
