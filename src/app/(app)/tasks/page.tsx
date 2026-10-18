import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, tasks, users } from "@/db/schema";
import { requireInternal, scopeToClients } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { Card, EmptyState, PageHeader, TeamAvatar } from "@/components/ui";
import { QuickTaskLines, TaskItem, type TaskItemData } from "./tasks-ui";

export const metadata: Metadata = { title: "Taken" };
export const dynamic = "force-dynamic";

// De vaste coördinatiekern — rolgebaseerd, geen vaste namen, zodat de rij
// meegroeit met het team. Deze personen staan er altijd; daarnaast verschijnt
// iedereen die op dit moment open taken heeft. Volgorde = deze rolprioriteit.
const OFFICE_ROLE_ORDER: Record<string, number> = {
  owner: 0,
  project_coordinator: 1,
  admin: 2,
};
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

  const [team, allOpen] = await Promise.all([
    listAssignableUsers(),
    db
      .select({ id: tasks.id, assigneeId: tasks.assigneeId, dueOn: tasks.dueOn })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN]), scopeToClients(viewer, tasks.clientId))),
  ]);
  const userOptions = team.map((u) => ({ id: u.id, fullName: u.fullName }));

  const openCountFor = (uid: string) => allOpen.filter((t) => t.assigneeId === uid).length;
  const algemeenCount = allOpen.filter((t) => !t.assigneeId).length;

  // Personenrij: álle interne teamleden staan er altijd (ook zonder open taken),
  // zodat iedereen direct selecteerbaar is. Kern eerst (op rolprioriteit, dan
  // naam), daarna de overigen op werkdruk (meeste open taken eerst, dan naam).
  const isOffice = (role: string) => role in OFFICE_ROLE_ORDER;
  const core = [...team]
    .sort((a, b) => {
      const ao = isOffice(a.primaryRole);
      const bo = isOffice(b.primaryRole);
      if (ao !== bo) return ao ? -1 : 1;
      if (ao && bo) return (OFFICE_ROLE_ORDER[a.primaryRole]! - OFFICE_ROLE_ORDER[b.primaryRole]!) || a.fullName.localeCompare(b.fullName, "nl");
      return openCountFor(b.id) - openCountFor(a.id) || a.fullName.localeCompare(b.fullName, "nl");
    });

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
        assigneeName: users.fullName,
        assigneeAvatar: users.avatarUrl,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
        clientLogo: clients.logoUrl,
      })
      .from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(where)
      .orderBy(asc(tasks.dueOn), desc(tasks.priority))
      .limit(400);
  }

  const selected = persoon && persoon !== "algemeen" ? team.find((u) => u.id === persoon) : null;
  const selectedLabel = selected ? selected.fullName : persoon === "algemeen" ? "Algemene taken" : null;

  let buckets: { label: string; tone?: "bad" | "warn"; items: TaskItemData[] }[] = [];
  if (persoon) {
    const assigneeCond = persoon === "algemeen" ? isNull(tasks.assigneeId) : eq(tasks.assigneeId, persoon);
    const [open, done, archived] = await Promise.all([
      fetchTasks(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN]), assigneeCond, scopeToClients(viewer, tasks.clientId))),
      // Afgerond maar nog niet gearchiveerd (recent): blijft in beeld.
      fetchTasks(and(isNull(tasks.deletedAt), eq(tasks.status, "done"), isNull(tasks.archivedAt), assigneeCond, scopeToClients(viewer, tasks.clientId))),
      // Gearchiveerd (automatisch na 7 dagen klaar) — blijft terugvindbaar.
      fetchTasks(and(isNull(tasks.deletedAt), isNotNull(tasks.archivedAt), assigneeCond, scopeToClients(viewer, tasks.clientId))),
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
      { label: `Gearchiveerd (${archived.length})`, items: (archived as TaskItemData[]).slice(0, 30) },
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
          // Actieve staat heeft een donkere achtergrond, dus tekst wit maken voor leesbaarheid
          className={`flex flex-col justify-center rounded-[var(--radius-md)] border px-3 py-2.5 text-sm ${!persoon ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-mist)] text-white" : "border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"}`}
        >
          <span className="font-medium">Iedereen</span>
          <span className={`text-xs ${!persoon ? "text-white/70" : "text-[var(--color-ink-muted)]"}`}>overzicht</span>
        </Link>
      </div>

      {canWrite ? (
        <div className="mb-4">
          <QuickTaskLines users={userOptions} defaultAssignee={selected?.id} />
        </div>
      ) : null}

      {!persoon ? (
        <Card>
          <EmptyState title="Kies een persoon" description="Klik hierboven op een teamlid of op Algemeen om de taken te zien." />
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
      // Actieve staat heeft een donkere achtergrond, dus tekst wit maken voor leesbaarheid
      className={`flex items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 ${active ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-mist)] text-white" : "border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"}`}
    >
      {generic ? (
        // Op de donkere actieve kaart een doorschijnend-witte chip gebruiken zodat 'AL' leesbaar blijft
        <span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${active ? "bg-white/15 text-white" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]"}`}>AL</span>
      ) : (
        <TeamAvatar name={name} size={32} />
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name.split(" ")[0]}</span>
        <span className={`text-xs ${active ? "text-white/70" : "text-[var(--color-ink-muted)]"}`}>{count} open</span>
      </span>
    </Link>
  );
}
