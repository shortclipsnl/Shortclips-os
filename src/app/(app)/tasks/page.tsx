import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, tasks, users } from "@/db/schema";
import { requireInternal, scopeToClients } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { Avatar, Card, EmptyState, PageHeader } from "@/components/ui";
import { NewTaskForm, TaskItem, type TaskItemData } from "./tasks-ui";

export const metadata: Metadata = { title: "Taken" };
export const dynamic = "force-dynamic";

const CORE = ["milou", "jiska", "rutger", "jarno"];
const firstName = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
const OPEN = ["todo", "in_progress", "blocked"] as const;

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ persoon?: string }> }) {
  const viewer = await requireInternal();
  const canWrite = viewer.permissions.has("tasks:write");
  const persoon = (await searchParams).persoon;

  const [assignable, activeClients, allOpen] = await Promise.all([
    canWrite ? listAssignableUsers() : Promise.resolve([]),
    canWrite
      ? db.select({ id: clients.id, name: clients.name }).from(clients).where(and(isNull(clients.deletedAt), eq(clients.status, "active"))).orderBy(asc(clients.name))
      : Promise.resolve([]),
    db
      .select({ id: tasks.id, assigneeId: tasks.assigneeId, dueOn: tasks.dueOn })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN]), scopeToClients(viewer, tasks.clientId))),
  ]);
  const userOptions = assignable.map((u) => ({ id: u.id, fullName: u.fullName }));

  // De vier kernmedewerkers in vaste volgorde.
  const core = CORE.map((fn) => assignable.find((u) => firstName(u.fullName) === fn)).filter((u): u is NonNullable<typeof u> => Boolean(u));
  const openCountFor = (uid: string) => allOpen.filter((t) => t.assigneeId === uid).length;
  const algemeenCount = allOpen.filter((t) => !t.assigneeId).length;

  // Taken voor de geselecteerde weergave ophalen.
  async function fetchTasks(where: ReturnType<typeof and>) {
    return db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueOn: tasks.dueOn,
        assigneeId: tasks.assigneeId,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
      })
      .from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(where)
      .orderBy(asc(tasks.dueOn), desc(tasks.priority))
      .limit(400);
  }

  const selected = persoon && persoon !== "algemeen" ? core.find((u) => u.id === persoon) : null;
  const selectedLabel = selected ? selected.fullName : persoon === "algemeen" ? "Algemene taken" : null;

  let buckets: { label: string; tone?: "bad" | "warn"; items: TaskItemData[] }[] = [];
  if (persoon) {
    const assigneeCond = persoon === "algemeen" ? isNull(tasks.assigneeId) : eq(tasks.assigneeId, persoon);
    const [open, done] = await Promise.all([
      fetchTasks(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN]), assigneeCond, scopeToClients(viewer, tasks.clientId))),
      fetchTasks(and(isNull(tasks.deletedAt), eq(tasks.status, "done"), assigneeCond, scopeToClients(viewer, tasks.clientId))),
    ]);
    const today = addDays(0);
    const weekEnd = addDays(7);
    const o = open as TaskItemData[];
    buckets = [
      { label: "Te laat", tone: "bad", items: o.filter((t) => t.dueOn && t.dueOn < today) },
      { label: "Vandaag", tone: "warn", items: o.filter((t) => t.dueOn === today) },
      { label: "Deze week", items: o.filter((t) => t.dueOn && t.dueOn > today && t.dueOn <= weekEnd) },
      { label: "Later / zonder datum", items: o.filter((t) => !t.dueOn || t.dueOn > weekEnd) },
      { label: "Afgerond", items: (done as TaskItemData[]).slice(0, 20) },
    ];
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Taken" description={selectedLabel ? `Taken van ${selectedLabel}` : "Kies een persoon om direct de taken te zien."} />

      {/* Personen als primaire navigatie */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {core.map((u) => (
          <PersonCard key={u.id} id={u.id} name={u.fullName} count={openCountFor(u.id)} active={persoon === u.id} />
        ))}
        <PersonCard id="algemeen" name="Algemeen" count={algemeenCount} active={persoon === "algemeen"} generic />
        <Link
          href="/tasks?persoon="
          className={`flex flex-col justify-center rounded-[var(--radius-md)] border px-3 py-2.5 text-sm ${!persoon ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-mist)]" : "border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"}`}
        >
          <span className="font-medium">Iedereen</span>
          <span className="text-xs text-[var(--color-ink-muted)]">overzicht</span>
        </Link>
      </div>

      {canWrite ? <div className="mb-4"><NewTaskForm users={userOptions} clients={activeClients} /></div> : null}

      {!persoon ? (
        <Card>
          <EmptyState title="Kies een persoon" description="Klik hierboven op Milou, Jiska, Rutger, Jarno of Algemeen om de taken te zien." />
        </Card>
      ) : (
        <div className="space-y-5">
          {buckets.map((b) =>
            b.items.length === 0 ? null : (
              <div key={b.label}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <span className={b.tone === "bad" ? "text-[var(--color-bad)]" : b.tone === "warn" ? "text-[var(--color-warn)]" : undefined}>{b.label}</span>
                  <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-muted)]">{b.items.length}</span>
                </h2>
                <Card padded={false}>
                  <ul className="divide-y divide-[var(--color-line)]">
                    {b.items.map((t) => <TaskItem key={t.id} task={t} users={userOptions} canWrite={canWrite} />)}
                  </ul>
                </Card>
              </div>
            ),
          )}
          {buckets.every((b) => b.items.length === 0) ? (
            <Card><EmptyState title="Geen taken" description="Er staat niets open voor deze weergave." /></Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PersonCard({ id, name, count, active, generic }: { id: string; name: string; count: number; active: boolean; generic?: boolean }) {
  return (
    <Link
      href={`/tasks?persoon=${id}`}
      className={`flex items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 ${active ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-mist)]" : "border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"}`}
    >
      {generic ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-surface-sunken)] text-xs font-semibold text-[var(--color-ink-muted)]">AL</span>
      ) : (
        <Avatar name={name} size={32} />
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name.split(" ")[0]}</span>
        <span className="text-xs text-[var(--color-ink-muted)]">{count} open</span>
      </span>
    </Link>
  );
}
