import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, handoverNotes, tasks, users } from "@/db/schema";
import { requireInternal, scopeToClients } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { isCoreStaff, coreStaffRank } from "@/server/core-staff";
import { Card, EmptyState, PageHeader, TeamAvatar } from "@/components/ui";
import { QuickTaskLines, TaskItem, type TaskItemData } from "./tasks-ui";
import { HandoverBoard, type HandoverNote } from "./handover-board";

export const metadata: Metadata = { title: "Taken" };
export const dynamic = "force-dynamic";

const OPEN = ["todo", "in_progress", "blocked"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ persoon?: string }> }) {
  const viewer = await requireInternal();
  const canWrite = viewer.permissions.has("tasks:write");
  const spPersoon = (await searchParams).persoon;

  const [team, allOpen, handoverRows] = await Promise.all([
    listAssignableUsers(),
    db
      .select({ id: tasks.id, assigneeId: tasks.assigneeId, dueOn: tasks.dueOn })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN]), scopeToClients(viewer, tasks.clientId))),
    db
      .select({ id: handoverNotes.id, body: handoverNotes.body, authorId: handoverNotes.authorId, forUserId: handoverNotes.forUserId, resolvedById: handoverNotes.resolvedById, createdAt: handoverNotes.createdAt, resolvedAt: handoverNotes.resolvedAt })
      .from(handoverNotes)
      .where(isNull(handoverNotes.deletedAt))
      .orderBy(asc(handoverNotes.resolvedAt), desc(handoverNotes.createdAt))
      .limit(50),
  ]);
  // Taken zijn alleen voor het interne kernteam — Jarno, Milou, Jiska en Rutger
  // (vaste lijst op e-mail, los van rol). Editors, videografen en freelancers
  // hebben dit niet nodig, dus die vallen uit de personenrij én de toewijslijst.
  const office = team.filter((u) => isCoreStaff(u.email));
  const userOptions = office.map((u) => ({ id: u.id, fullName: u.fullName }));

  // Overdrachtspunten: namen opzoeken uit het team.
  const nameById = new Map(team.map((u) => [u.id, u.fullName] as const));
  const handover: HandoverNote[] = handoverRows.map((h) => ({
    id: h.id,
    body: h.body,
    authorName: h.authorId ? nameById.get(h.authorId) ?? null : null,
    forUserName: h.forUserId ? nameById.get(h.forUserId) ?? null : null,
    createdAt: new Date(h.createdAt).toISOString(),
    resolvedAt: h.resolvedAt ? new Date(h.resolvedAt).toISOString() : null,
    resolvedByName: h.resolvedById ? nameById.get(h.resolvedById) ?? null : null,
  }));

  // Eerste bezoek (geen ?persoon): meteen je eigen taken tonen i.p.v. "Kies een
  // persoon". De knop "Iedereen" stuurt een lege ?persoon= en houdt het overzicht.
  const persoon = spPersoon === undefined && office.some((u) => u.id === viewer.id) ? viewer.id : spPersoon;
  // Open overdrachtspunten (voor het aantal op de kleine "Overdracht"-kaart).
  const handoverOpen = handover.filter((h) => !h.resolvedAt).length;

  const openCountFor = (uid: string) => allOpen.filter((t) => t.assigneeId === uid).length;
  const algemeenCount = allOpen.filter((t) => !t.assigneeId).length;

  // Personenrij: het kernteam in de vaste volgorde (Jarno, Milou, Jiska, Rutger).
  const core = [...office].sort((a, b) => coreStaffRank(a.email) - coreStaffRank(b.email));

  // Taken voor de geselecteerde weergave ophalen.
  async function fetchTasks(where: ReturnType<typeof and>) {
    return db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        category: tasks.category,
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

  const selected = persoon && persoon !== "algemeen" && persoon !== "overdracht" ? team.find((u) => u.id === persoon) : null;
  const selectedLabel = selected ? selected.fullName : persoon === "algemeen" ? "Algemene taken" : persoon === "overdracht" ? "Overdracht" : null;

  let buckets: { label: string; tone?: "bad" | "warn"; items: TaskItemData[] }[] = [];
  if (persoon && persoon !== "overdracht") {
    const assigneeCond = persoon === "algemeen" ? isNull(tasks.assigneeId) : eq(tasks.assigneeId, persoon);
    const [open, done, archived] = await Promise.all([
      fetchTasks(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN]), assigneeCond, scopeToClients(viewer, tasks.clientId))),
      // Afgerond maar nog niet gearchiveerd (recent): blijft in beeld.
      fetchTasks(and(isNull(tasks.deletedAt), eq(tasks.status, "done"), isNull(tasks.archivedAt), assigneeCond, scopeToClients(viewer, tasks.clientId))),
      // Gearchiveerd (automatisch na 7 dagen klaar) — blijft terugvindbaar.
      fetchTasks(and(isNull(tasks.deletedAt), isNotNull(tasks.archivedAt), assigneeCond, scopeToClients(viewer, tasks.clientId))),
    ]);
    // Openstaande taken groeperen per soort: zo staat scripting apart van
    // klantcontact en overige taken, in plaats van één lange lijst.
    const o = open as TaskItemData[];
    const byCat = (cat: string) => o.filter((t) => (t.category || "overig") === cat);
    buckets = [
      { label: "Scripting", items: byCat("scripting") },
      { label: "Klantcontact", items: byCat("klantcontact") },
      { label: "Overige taken", items: byCat("overig") },
      { label: "Afgerond", items: (done as TaskItemData[]).slice(0, 20) },
      { label: `Gearchiveerd (${archived.length})`, items: (archived as TaskItemData[]).slice(0, 30) },
    ];
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Taken" description={selectedLabel ? `Taken van ${selectedLabel}` : "Kies een persoon om direct de taken te zien."} />

      {/* Personen als primaire navigatie — eigen taken staan zo meteen bovenaan.
          Overdracht is een klein tabblad naast "Algemeen" i.p.v. een groot blok. */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {core.map((u) => (
          <PersonCard key={u.id} id={u.id} name={u.fullName} count={openCountFor(u.id)} active={persoon === u.id} />
        ))}
        <PersonCard id="algemeen" name="Algemeen" count={algemeenCount} active={persoon === "algemeen"} generic chip="AL" />
        <PersonCard id="overdracht" name="Overdracht" count={handoverOpen} active={persoon === "overdracht"} generic chip="⇄" countLabel="open" accent="var(--color-violet)" />
      </div>

      {canWrite && persoon !== "overdracht" ? (
        <div className="mb-4">
          {/* key op de geselecteerde persoon: zo herstart het formulier bij het
              wisselen van persoon en staat de toewijzing meteen op de juiste
              persoon (geen extra handeling). "Algemeen" start zonder toewijzing. */}
          <QuickTaskLines
            key={`qt-${persoon ?? "none"}`}
            users={userOptions}
            defaultAssignee={selected?.id ?? (persoon === "algemeen" ? undefined : office.some((u) => u.id === viewer.id) ? viewer.id : undefined)}
          />
        </div>
      ) : null}

      {persoon === "overdracht" ? (
        <HandoverBoard notes={handover} users={userOptions} canWrite={canWrite} />
      ) : !persoon ? (
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
                    {b.items.map((t) => <TaskItem key={t.id} task={t} users={userOptions} canWrite={canWrite} celebrateName={viewer.fullName.split(" ")[0] ?? ""} />)}
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

function PersonCard({ id, name, count, active, generic, chip = "AL", countLabel = "open", accent }: { id: string; name: string; count: number; active: boolean; generic?: boolean; chip?: string; countLabel?: string; accent?: string }) {
  return (
    <Link
      href={`/tasks?persoon=${id}`}
      // Actieve staat heeft een donkere achtergrond, dus tekst wit maken voor leesbaarheid
      className={`flex items-center gap-3.5 rounded-[var(--radius-md)] border px-4 py-3.5 ${active ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-mist)] text-white" : "border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"}`}
    >
      {generic ? (
        // Op de donkere actieve kaart een doorschijnend-witte chip gebruiken zodat het label leesbaar blijft
        <span
          className={`grid size-16 shrink-0 place-items-center rounded-full text-base font-semibold ${active ? "bg-white/15 text-white" : accent ? "text-white" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]"}`}
          style={!active && accent ? { background: accent } : undefined}
        >
          {chip}
        </span>
      ) : (
        <TeamAvatar name={name} size={64} />
      )}
      <span className="min-w-0">
        <span className="block truncate text-lg font-semibold">{name.split(" ")[0]}</span>
        {/* Open items krijgen een kleurtje zodat ze opvallen; 0 blijft rustig. */}
        <span
          className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
            active
              ? "bg-white/20 text-white"
              : count > 0
                ? "bg-[var(--color-warn-soft)] text-[#8a5300]"
                : "bg-[var(--color-surface-2)] text-[var(--color-ink-faint)] font-medium"
          }`}
        >
          {count} {countLabel}
        </span>
      </span>
    </Link>
  );
}
