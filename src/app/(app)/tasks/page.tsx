import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, tasks, users } from "@/db/schema";
import { requireInternal, scopeToClients } from "@/server/auth/context";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { TaskRow } from "./task-row";

export const metadata: Metadata = { title: "Taken" };
export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ van?: string; status?: string }>;
}) {
  const viewer = await requireInternal();
  const params = await searchParams;
  const mine = params.van !== "iedereen";

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueOn: tasks.dueOn,
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
        params.status === "klaar"
          ? eq(tasks.status, "done")
          : inArray(tasks.status, ["todo", "in_progress", "blocked"]),
        mine ? eq(tasks.assigneeId, viewer.id) : undefined,
        scopeToClients(viewer, tasks.clientId),
      ),
    )
    .orderBy(asc(tasks.dueOn), desc(tasks.priority))
    .limit(300);

  const canWrite = viewer.permissions.has("tasks:write");

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Taken"
        description={`${rows.length} ${params.status === "klaar" ? "afgeronde" : "openstaande"} taken`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/tasks" className={chip(mine && params.status !== "klaar")}>
          Van mij
        </Link>
        <Link href="/tasks?van=iedereen" className={chip(!mine && params.status !== "klaar")}>
          Iedereen
        </Link>
        <Link
          href={`/tasks?status=klaar${mine ? "" : "&van=iedereen"}`}
          className={chip(params.status === "klaar")}
        >
          Afgerond
        </Link>
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            title="Geen taken"
            description={mine ? "Er staat niets voor jou open." : "Er staan geen taken open."}
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {rows.map((t) => (
              <TaskRow key={t.id} task={t} canWrite={canWrite} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function chip(active: boolean): string {
  return active
    ? "rounded-full bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
    : "rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]";
}
