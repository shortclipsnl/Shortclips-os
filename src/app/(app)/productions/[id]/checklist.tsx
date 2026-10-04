"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleChecklistItem } from "@/server/actions/productions";
import { cn } from "@/lib/cn";

export function ChecklistItem({
  id,
  label,
  isDone,
  isBlocking,
  canEdit,
}: {
  id: string;
  label: string;
  isDone: boolean;
  isBlocking: boolean;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <input
        type="checkbox"
        checked={isDone}
        disabled={!canEdit || pending}
        onChange={() =>
          start(async () => {
            await toggleChecklistItem(id);
            router.refresh();
          })
        }
        className="size-4 shrink-0 accent-[var(--color-brand-500)]"
        aria-label={label}
      />
      <span
        className={cn(
          "min-w-0 flex-1 text-sm",
          isDone && "text-[var(--color-ink-faint)] line-through",
        )}
      >
        {label}
      </span>
      {isBlocking && !isDone ? (
        <span className="text-2xs font-semibold tracking-wide text-[var(--color-bad)] uppercase">
          blokkerend
        </span>
      ) : null}
    </li>
  );
}
