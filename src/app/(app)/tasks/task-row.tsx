"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setTaskStatus } from "@/server/actions/tasks";
import { Avatar, Badge } from "@/components/ui";
import { relativeDays } from "@/lib/format";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/statuses";
import { cn } from "@/lib/cn";

export function TaskRow({
  task,
  canWrite,
}: {
  task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueOn: string | null;
    assigneeName: string | null;
    clientName: string | null;
    clientSlug: string | null;
    clientColor: string | null;
  };
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const done = task.status === "done";
  const overdue = task.dueOn && !done && task.dueOn < new Date().toISOString().slice(0, 10);

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <input
        type="checkbox"
        checked={done}
        disabled={!canWrite || pending}
        onChange={() =>
          start(async () => {
            await setTaskStatus(task.id, done ? "todo" : "done");
            router.refresh();
          })
        }
        className="size-4 shrink-0 accent-[var(--color-good)]"
        aria-label={`Taak afronden: ${task.title}`}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", done && "text-[var(--color-ink-faint)] line-through")}>
          {task.title}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          {task.clientSlug ? (
            <Link href={`/clients/${task.clientSlug}`} className="inline-flex items-center gap-1 hover:underline">
              <Avatar name={task.clientName ?? "?"} color={task.clientColor} size={14} />
              {task.clientName}
            </Link>
          ) : (
            <span>intern</span>
          )}
          {task.assigneeName ? <span>· {task.assigneeName}</span> : null}
          {task.dueOn ? (
            <span className={overdue ? "font-medium text-[var(--color-bad)]" : undefined}>
              · {relativeDays(task.dueOn)}
            </span>
          ) : null}
        </span>
      </span>
      <Badge tone={TASK_PRIORITY[task.priority]?.tone ?? "neutral"}>
        {TASK_PRIORITY[task.priority]?.label}
      </Badge>
      <Badge tone={TASK_STATUS[task.status]?.tone ?? "neutral"}>
        {TASK_STATUS[task.status]?.label}
      </Badge>
    </li>
  );
}
