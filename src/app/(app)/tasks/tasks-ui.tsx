"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createTask, createTasksBulk, deleteTask, setTaskStatus, updateTask } from "@/server/actions/tasks";
import { Button, ClientLogo, ErrorNote, TeamAvatar } from "@/components/ui";
import { cn } from "@/lib/cn";

export type UserOption = { id: string; fullName: string };
export type ClientOption = { id: string; name: string };

export type TaskItemData = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueOn: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  clientName: string | null;
  clientSlug: string | null;
  clientColor: string | null;
  clientLogo: string | null;
};

const PRIORITIES = [
  { value: "low", label: "Laag" },
  { value: "normal", label: "Normaal" },
  { value: "high", label: "Hoog" },
  { value: "urgent", label: "Urgent" },
];

const prioDot: Record<string, string> = {
  low: "var(--color-ink-faint)",
  normal: "var(--color-info)",
  high: "var(--color-warn)",
  urgent: "var(--color-bad)",
};

/** Supersnelle invoer: typ taken, één per regel. Elke regel wordt een taak. */
export function QuickTaskLines({ users, defaultAssignee }: { users: UserOption[]; defaultAssignee?: string }) {
  const [lines, setLines] = useState("");
  const [assigneeId, setAssigneeId] = useState(defaultAssignee ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!lines.trim()) return;
    start(async () => {
      const res = await createTasksBulk({ lines, assigneeId: assigneeId || null });
      if (res.ok) {
        setLines("");
        setErr(null);
        router.refresh();
      } else {
        setErr(res.message ?? "Mislukt");
      }
    });
  }

  const count = lines.split(/\r?\n/).filter((l) => l.replace(/^[-*•\s]+/, "").trim().length > 0).length;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[var(--color-ink-muted)]">Snel toevoegen — typ taken, één per regel:</span>
        <select className="sc-input ml-auto h-8 w-40 py-0 text-xs" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Toewijzen aan">
          <option value="">Algemeen / niet toegewezen</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName}</option>
          ))}
        </select>
      </div>
      <textarea
        className="sc-input resize-y text-sm leading-relaxed"
        rows={4}
        placeholder={"• Montage Koops afmaken\n• Script Luxewagen inplannen\n• Feedback KKFH verwerken"}
        value={lines}
        onChange={(e) => setLines(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
        }}
      />
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={add} disabled={pending || count === 0} size="sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {count > 0 ? `${count} ${count === 1 ? "taak" : "taken"} toevoegen` : "Toevoegen"}
        </Button>
        <span className="text-xs text-[var(--color-ink-faint)]">Tip: ⌘/Ctrl + Enter om toe te voegen.</span>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}

export function NewTaskForm({ users, clients }: { users: UserOption[]; clients: ClientOption[] }) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [clientId, setClientId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueOn, setDueOn] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!title.trim()) return;
    start(async () => {
      const res = await createTask({
        title,
        assigneeId: assigneeId || null,
        clientId: clientId || null,
        priority: priority as "normal",
        dueOn: dueOn || null,
      });
      if (res.ok) {
        setTitle("");
        setDueOn("");
        setErr(null);
        router.refresh();
      } else {
        setErr(res.message ?? "Mislukt");
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="sc-input min-w-48 flex-1"
          placeholder="Nieuwe taak…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <select className="sc-input w-36" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Toewijzen aan">
          <option value="">Algemeen</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName}</option>
          ))}
        </select>
        <select className="sc-input w-36" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Klant">
          <option value="">Intern</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="sc-input w-28" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Prioriteit">
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <input className="sc-input w-36" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Deadline" />
        <Button onClick={add} disabled={pending || !title.trim()} size="sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Toevoegen
        </Button>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}

export function TaskItem({
  task,
  users,
  canWrite,
}: {
  task: TaskItemData;
  users: UserOption[];
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const done = task.status === "done";
  const overdue = task.dueOn && !done && task.dueOn < new Date().toISOString().slice(0, 10);

  function run(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <input
        type="checkbox"
        checked={done}
        disabled={!canWrite || pending}
        onChange={() => run(() => setTaskStatus(task.id, done ? "todo" : "done"))}
        className="size-4 shrink-0 accent-[var(--color-good)]"
        aria-label={`Taak afronden: ${task.title}`}
      />
      <span className="min-w-40 flex-1">
        <span className={cn("block text-sm font-medium", done && "text-[var(--color-ink-faint)] line-through")}>
          {task.title}
        </span>
        {task.clientSlug ? (
          <Link href={`/clients/${task.clientSlug}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:underline">
            <ClientLogo name={task.clientName ?? "?"} logoUrl={task.clientLogo} color={task.clientColor} size={14} />
            {task.clientName}
          </Link>
        ) : (
          <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">intern</span>
        )}
      </span>

      {task.assigneeName ? (
        <span className="hidden shrink-0 items-center gap-1.5 text-xs text-[var(--color-ink-muted)] sm:inline-flex" title={`Toegewezen aan ${task.assigneeName}`}>
          <TeamAvatar name={task.assigneeName} avatarUrl={task.assigneeAvatar} size={20} />
        </span>
      ) : null}

      {canWrite ? (
        <>
          <select
            className="sc-input h-8 w-32 py-0 text-xs"
            value={task.assigneeId ?? ""}
            disabled={pending}
            onChange={(e) => run(() => updateTask(task.id, { assigneeId: e.target.value || null }))}
            aria-label="Toegewezen aan"
          >
            <option value="">Algemeen</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>

          <select
            className="sc-input h-8 w-24 py-0 text-xs"
            value={task.priority}
            disabled={pending}
            onChange={(e) => run(() => updateTask(task.id, { priority: e.target.value as "normal" }))}
            aria-label="Prioriteit"
            style={{ color: prioDot[task.priority] }}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          <input
            type="date"
            className={cn("sc-input h-8 w-32 py-0 text-xs", overdue && "text-[var(--color-bad)]")}
            value={task.dueOn ?? ""}
            disabled={pending}
            onChange={(e) => run(() => updateTask(task.id, { dueOn: e.target.value || null }))}
            aria-label="Deadline"
          />

          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deleteTask(task.id))}
            className="shrink-0 rounded p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]"
            aria-label="Taak verwijderen"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </>
      ) : (
        <span className="text-xs text-[var(--color-ink-muted)]">
          {task.dueOn ? task.dueOn : ""} · {PRIORITIES.find((p) => p.value === task.priority)?.label}
        </span>
      )}
    </li>
  );
}
