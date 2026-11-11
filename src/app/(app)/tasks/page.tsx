import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, handoverNotes, tasks, users } from "@/db/schema";
import { requireInternal, scopeToClients } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { isCoreStaff, coreStaffRank } from "@/server/core-staff";
import { Card, EmptyState, PageHeader, TeamAvatar } from "@/components/ui";
import { ColleagueToggle, QuickTaskLines, TaskItem, type TaskItemData } from "./tasks-ui";
import { HandoverBoard, type HandoverNote } from "./handover-board";
import { syncScriptingTasksIfStale } from "@/server/scripting-tasks";
import { taskHref } from "@/lib/task-links";
import { taskSignal } from "@/lib/task-signals";

export const metadata: Metadata = { title: "Taken" };
export const dynamic = "force-dynamic";

const OPEN = ["todo", "in_progress", "blocked"] as const;

/**
 * Controletaken (opscontrol:) die niet op de takenpagina horen: alleen de
 * klantherinnering voor feedback blijft. Video's versturen, inplannen of
 * goedkeuren weet het team zelf.
 */
const NOT_HIDDEN_OPS = sql`not (coalesce(${tasks.dedupeKey}, '') like 'opscontrol:%' and coalesce(${tasks.dedupeKey}, '') not like '%klantfeedback:feedback-ontbreekt:%' and coalesce(${tasks.dedupeKey}, '') not like '%klantfeedback:te-laat-bij-klant:%')`;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ persoon?: string }> }) {
  const viewer = await requireInternal();
  const canWrite = viewer.permissions.has("tasks:write");
  const spPersoon = (await searchParams).persoon;
  // Vangnet: scriptingtaken bijwerken met de actuele scriptingstatussen.
  await syncScriptingTasksIfStale();

  const [team, allOpen, handoverRows] = await Promise.all([
    listAssignableUsers(),
    db
      .select({ id: tasks.id, assigneeId: tasks.assigneeId, dueOn: tasks.dueOn })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN]), sql`not (${tasks.source} = 'automation' and ${tasks.entityType} = 'ai_insight')`, NOT_HIDDEN_OPS, scopeToClients(viewer, tasks.clientId))),
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

  // Iedereen ziet standaard de eigen taken. Een lege of ontbrekende ?persoon valt
  // terug op de eigen weergave (geen "Kies een persoon"-tussenstap meer).
  const persoon = spPersoon && spPersoon.length ? spPersoon : viewer.id;
  // Open overdrachtspunten (voor het aantal op de kleine "Overdracht"-kaart).
  const handoverOpen = handover.filter((h) => !h.resolvedAt).length;

  const openCountFor = (uid: string) => allOpen.filter((t) => t.assigneeId === uid).length;
  const algemeenCount = allOpen.filter((t) => !t.assigneeId).length;

  // Personenrij: het kernteam in de vaste volgorde (Jarno, Milou, Jiska, Rutger).
  const core = [...office].sort((a, b) => coreStaffRank(a.email) - coreStaffRank(b.email));
  // Staat de viewer zelf niet in het kernteam (bijv. een editor), zet 'm dan
  // vooraan als eigen chip — zo ziet iedereen z'n eigen taken en kan die er na
  // "Iedereen" weer naartoe.
  const inCore = core.some((u) => u.id === viewer.id);
  const persons = inCore ? core : [{ id: viewer.id, fullName: `${viewer.fullName} (jij)` }, ...core];

  // Taken voor de geselecteerde weergave ophalen. De automatisch gegenereerde
  // AI-verbeterpunten (source "automation" + entiteit "ai_insight") blijven hier
  // buiten beeld — die horen niet in de takenlijst. Echte actiepunten en
  // handmatig doorgezette verbeterpunten blijven gewoon staan.
  async function fetchTasks(where: ReturnType<typeof and>): Promise<TaskItemData[]> {
    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
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
        entityType: tasks.entityType,
        entityId: tasks.entityId,
        dedupeKey: tasks.dedupeKey,
      })
      .from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(where, sql`not (${tasks.source} = 'automation' and ${tasks.entityType} = 'ai_insight')`, NOT_HIDDEN_OPS))
      .orderBy(asc(tasks.dueOn), desc(tasks.priority))
      .limit(400);
    // Doorklikken naar waar de taak over gaat (bijv. de scriptsessie).
    // Feedbackherinnering en maandrapportage krijgen een compacte, opvallende weergave.
    return rows.map(({ entityType, entityId, dedupeKey, ...t }) => ({
      ...t,
      href: taskHref({ entityType, entityId, dedupeKey }),
      signal: taskSignal({ title: t.title, description: t.description, dedupeKey, entityType, entityId, clientName: t.clientName }),
    }));
  }

  const selected = persoon && persoon !== "algemeen" && persoon !== "overdracht" ? team.find((u) => u.id === persoon) : null;
  // Label voor de kop: ook als de viewer zelf niet in de toewijsbare lijst staat,
  // tonen we bij de eigen weergave netjes "Taken van <jij>".
  const selectedLabel = selected ? selected.fullName : persoon === viewer.id ? viewer.fullName : persoon === "algemeen" ? "Verdelen onder team" : persoon === "overdracht" ? "Overdracht" : null;

  // Alle open taken in één lijst (geen Klantcontact/Werkzaamheden-splitsing meer):
  // de nadruk ligt op de werkzaamheden die echt uitgevoerd moeten worden.
  // Afgerond en gearchiveerd eronder, op volle breedte.
  let openItems: TaskItemData[] = [];
  let afgerond: TaskItemData[] = [];
  let gearchiveerd: TaskItemData[] = [];
  if (persoon && persoon !== "overdracht") {
    const assigneeCond = persoon === "algemeen" ? isNull(tasks.assigneeId) : eq(tasks.assigneeId, persoon);
    const [open, done, archived] = await Promise.all([
      fetchTasks(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN]), assigneeCond, scopeToClients(viewer, tasks.clientId))),
      fetchTasks(and(isNull(tasks.deletedAt), eq(tasks.status, "done"), isNull(tasks.archivedAt), assigneeCond, scopeToClients(viewer, tasks.clientId))),
      fetchTasks(and(isNull(tasks.deletedAt), isNotNull(tasks.archivedAt), assigneeCond, scopeToClients(viewer, tasks.clientId))),
    ]);
    openItems = open as TaskItemData[];
    afgerond = (done as TaskItemData[]).slice(0, 20);
    gearchiveerd = (archived as TaskItemData[]).slice(0, 30);
  }
  const openTotal = openItems.length;

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      {/* Primaire kop: de eigen taken van vandaag vallen meteen op. Een collega of
          "Verdelen" toont die weergave; Overdracht krijgt een eigen titel. */}
      {persoon === "overdracht" ? (
        <PageHeader title="Overdracht" description="Punten die aan een collega worden overgedragen." />
      ) : (
        <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--color-indigo-ink)] to-[var(--color-brand-600)] px-4 py-3.5 text-white">
          <ListChecks className="size-6 shrink-0" />
          <h1 className="text-lg font-semibold tracking-tight">
            {persoon === viewer.id ? "Mijn taken voor vandaag" : persoon === "algemeen" ? "Nog te verdelen onder het team" : `Taken van ${selectedLabel}`}
          </h1>
          <span className="ml-auto rounded-full bg-white/20 px-3 py-0.5 text-sm font-bold tabular-nums">{openTotal}</span>
        </div>
      )}

      {/* Collega's achter een knop — standaard dicht zodat de focus op de eigen
          taken ligt. Bij het bekijken van een ander staat de rij open (om terug te
          kunnen). */}
      <ColleagueToggle defaultOpen={persoon !== viewer.id}>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {persons.map((u) => (
            <PersonCard key={u.id} id={u.id} name={u.fullName} count={openCountFor(u.id)} active={persoon === u.id} />
          ))}
          <PersonCard id="algemeen" name="Verdelen onder team" count={algemeenCount} active={persoon === "algemeen"} generic chip="⇢" countLabel="te verdelen" />
          <PersonCard id="overdracht" name="Overdracht" count={handoverOpen} active={persoon === "overdracht"} generic chip="⇄" countLabel="open" accent="var(--color-violet)" />
        </div>
      </ColleagueToggle>

      {persoon === "overdracht" ? (
        <HandoverBoard notes={handover} users={userOptions} canWrite={canWrite} />
      ) : (
        <div className="space-y-4">
          {openTotal === 0 && afgerond.length === 0 && gearchiveerd.length === 0 ? (
            <Card><EmptyState title="Geen taken" description="Er staat niets open voor deze weergave." /></Card>
          ) : null}

          {/* Eén lijst met werkzaamheden — dit is de hoofdfocus van de pagina. */}
          {openTotal > 0 ? (
            <TaskColumn title="Werkzaamheden" accent="var(--color-brand-500)" items={openItems} users={userOptions} canWrite={canWrite} celebrateName={viewer.fullName.split(" ")[0] ?? ""} />
          ) : null}

          {/* Kleiner toevoegvak onder de lijst — minder nadruk dan de taken zelf. */}
          {canWrite ? (
            <QuickTaskLines
              compact
              key={`qt-${persoon ?? "none"}`}
              users={userOptions}
              defaultAssignee={selected?.id ?? (persoon === "algemeen" ? undefined : persoon === viewer.id ? viewer.id : undefined)}
            />
          ) : null}

          {afgerond.length > 0 ? <TaskColumn title="Afgerond" accent="var(--color-good)" items={afgerond} users={userOptions} canWrite={canWrite} celebrateName="" /> : null}
          {gearchiveerd.length > 0 ? <TaskColumn title={`Gearchiveerd (${gearchiveerd.length})`} accent="var(--color-ink-faint)" items={gearchiveerd} users={userOptions} canWrite={canWrite} celebrateName="" /> : null}
        </div>
      )}
    </div>
  );
}

/** Eén kolom/blok met een gekleurde koptitel en de taakregels (of "niets open"). */
function TaskColumn({ title, accent, items, users, canWrite, celebrateName }: {
  title: string; accent: string; items: TaskItemData[]; users: { id: string; fullName: string }[]; canWrite: boolean; celebrateName: string;
}) {
  return (
    <div className="min-w-0">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="size-2 shrink-0 rounded-full" style={{ background: accent }} />
        {title}
        <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-muted)]">{items.length}</span>
      </h2>
      <Card padded={false}>
        {items.length === 0 ? (
          <p className="px-4 py-7 text-center text-sm text-[var(--color-ink-faint)]">Niets open</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {items.map((t) => <TaskItem key={t.id} task={t} users={users} canWrite={canWrite} celebrateName={celebrateName} />)}
          </ul>
        )}
      </Card>
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
