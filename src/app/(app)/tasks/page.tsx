import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, tasks, users } from "@/db/schema";
import { requireInternal, scopeToClients } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { NewTaskForm, TaskItem, type TaskItemData } from "./tasks-ui";

export const metadata: Metadata = { title: "Taken" };
export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ van?: string; status?: string }>;
}) {
  const viewer = await requireInternal();
  const params = await searchParams;
  const done = params.status === "klaar";
  const mine = params.van === "mij";
  const canWrite = viewer.permissions.has("tasks:write");

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueOn: tasks.dueOn,
      assigneeId: tasks.assigneeId,
      assigneeName: users.fullName,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(clients, eq(clients.id, tasks.clientId))
    .where(
      and(
        isNull(tasks.deletedAt),
        done ? eq(tasks.status, "done") : inArray(tasks.status, ["todo", "in_progress", "blocked"]),
        mine ? eq(tasks.assigneeId, viewer.id) : undefined,
        scopeToClients(viewer, tasks.clientId),
      ),
    )
    .orderBy(asc(tasks.dueOn), desc(tasks.priority))
    .limit(500);

  const [assignable, activeClients] = await Promise.all([
    canWrite ? listAssignableUsers() : Promise.resolve([]),
    canWrite
      ? db
          .select({ id: clients.id, name: clients.name })
          .from(clients)
          .where(and(isNull(clients.deletedAt), eq(clients.status, "active")))
          .orderBy(asc(clients.name))
      : Promise.resolve([]),
  ]);
  const userOptions = assignable.map((u) => ({ id: u.id, fullName: u.fullName }));

  const mineOpen = rows.filter((r) => !done && r.assigneeId === viewer.id).length;

  // Groeperen: "Algemeen" (geen toegewezene) + één sectie per persoon.
  type Group = { key: string; label: string; items: TaskItemData[] };
  const groups: Group[] = [];
  if (!mine && !done) {
    const general: TaskItemData[] = [];
    const byUser = new Map<string, { label: string; items: TaskItemData[] }>();
    for (const r of rows) {
      const item = r as TaskItemData;
      if (!r.assigneeId) {
        general.push(item);
      } else {
        const g = byUser.get(r.assigneeId) ?? { label: r.assigneeName ?? "Onbekend", items: [] };
        g.items.push(item);
        byUser.set(r.assigneeId, g);
      }
    }
    if (general.length) groups.push({ key: "algemeen", label: "Algemene Shortclips-taken", items: general });
    for (const [uid, g] of [...byUser.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label))) {
      groups.push({ key: uid, label: g.label, items: g.items });
    }
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Taken" description={`${rows.length} ${done ? "afgeronde" : "openstaande"} taken`} />

      {!done ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Mijn openstaande taken" value={mineOpen} tone={mineOpen > 0 ? "warn" : undefined} href="/tasks?van=mij" />
          <Stat label="Alle openstaande taken" value={rows.length} href="/tasks" />
        </div>
      ) : null}

      {canWrite && !done ? (
        <div className="mb-4">
          <NewTaskForm users={userOptions} clients={activeClients} />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/tasks" className={chip(!mine && !done)}>Alle taken</Link>
        <Link href="/tasks?van=mij" className={chip(mine && !done)}>Van mij</Link>
        <Link href="/tasks?status=klaar" className={chip(done)}>Afgerond</Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="Geen taken" description={mine ? "Er staat niets voor jou open." : "Er staan geen taken open."} />
        </Card>
      ) : mine || done ? (
        <Card padded={false}>
          <ul className="divide-y divide-[var(--color-line)]">
            {(rows as TaskItemData[]).map((t) => (
              <TaskItem key={t.id} task={t} users={userOptions} canWrite={canWrite} />
            ))}
          </ul>
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {g.label}
                <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-muted)]">
                  {g.items.length}
                </span>
              </h2>
              <Card padded={false}>
                <ul className="divide-y divide-[var(--color-line)]">
                  {g.items.map((t) => (
                    <TaskItem key={t.id} task={t} users={userOptions} canWrite={canWrite} />
                  ))}
                </ul>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function chip(active: boolean): string {
  return active
    ? "rounded-full bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
    : "rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]";
}
