import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, opsControlItems, opsControlRuns, users, type OpsDomainHealth, type OpsRunSummary } from "@/db/schema";
import { canManageOperations, isOwner, type Viewer } from "@/server/auth/context";
import { CORE_STAFF_EMAILS, coreStaffRank, isCoreStaff } from "@/server/core-staff";
import { amsterdamClock, type OpsDomain } from "@/lib/ops-control/plan";
import { getOpsSettings, resolveEscalationPeople } from "./settings";

/**
 * Gegevens voor het dashboardblok "Operationele controle". Gebaseerd op de
 * laatste controlerun: wat er toen openstond, per onderdeel en per persoon.
 * Alleen voor het interne kernteam en de operationeel beheerder.
 */

export type OpsItemView = {
  id: string;
  domain: OpsDomain;
  category: string;
  clientLabel: string | null;
  ownerId: string | null;
  ownerName: string | null;
  action: string;
  reason: string | null;
  severity: "rood" | "oranje";
  priority: "hoog" | "normaal";
  dueOn: string | null;
  escalationLevel: number;
  escalatedToName: string | null;
  verifiable: boolean;
  manualDoneCount: number;
  since: string;
  href: string;
};

export type OpsOverview = {
  today: string;
  lastRun: { at: string; slot: string; status: string } | null;
  lastScheduledRun: { at: string; slot: string } | null;
  checkedToday: boolean;
  health: OpsDomainHealth[];
  items: OpsItemView[];
  resolvedToday: { auto: number; manual: number };
  people: { id: string; name: string }[];
  gaps: { coordinator: string[]; videographer: string[]; editor: string[] };
  me: string;
  leadName: string | null;
  isLead: boolean;
  canRun: boolean;
  defaultScope: "mine" | "team";
  times: { morning: string; midday: string; afternoon: string };
  enabled: boolean;
};

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

export async function getOpsOverview(viewer: Viewer): Promise<OpsOverview | null> {
  const ops = canManageOperations(viewer);
  if (!ops && !isCoreStaff(viewer.email)) return null;

  const clock = amsterdamClock(new Date());
  const today = clock.date;
  const settings = await getOpsSettings();
  const people = await resolveEscalationPeople(settings);

  const [runs, rows, resolved, staff, activeClients] = await Promise.all([
    db.select().from(opsControlRuns).where(eq(opsControlRuns.status, "success")).orderBy(desc(opsControlRuns.startedAt)).limit(10),
    db.select().from(opsControlItems).where(eq(opsControlItems.status, "open")),
    db.select({ resolution: opsControlItems.resolution, n: sql<number>`count(*)::int` }).from(opsControlItems)
      .where(and(eq(opsControlItems.status, "resolved"), gte(opsControlItems.resolvedAt, sql`date_trunc('day', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam'`)))
      .groupBy(opsControlItems.resolution),
    db.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users)
      .where(and(inArray(sql`lower(${users.email})`, [...CORE_STAFF_EMAILS]), isNull(users.deletedAt))),
    db.select({ name: clients.name, coordinatorId: clients.coordinatorId, videographerId: clients.videographerId, editorName: clients.editorName })
      .from(clients).where(and(eq(clients.status, "active"), isNull(clients.deletedAt))),
  ]);

  const allUsers = await db.select({ id: users.id, fullName: users.fullName }).from(users);
  const nameById = new Map(allUsers.map((u) => [u.id, firstName(u.fullName)]));

  const last = runs[0] ?? null;
  const lastScheduled = runs.find((r) => r.slot !== "handmatig") ?? null;
  const summary = (last?.summary ?? null) as OpsRunSummary | null;

  const items: OpsItemView[] = rows.map((r) => ({
    id: r.id, domain: r.domain as OpsDomain, category: r.category, clientLabel: r.clientLabel,
    ownerId: r.ownerId, ownerName: r.ownerId ? nameById.get(r.ownerId) ?? null : null,
    action: r.action, reason: r.reason, severity: (r.severity === "rood" ? "rood" : "oranje") as "rood" | "oranje",
    priority: (r.priority === "hoog" ? "hoog" : "normaal") as "hoog" | "normaal", dueOn: r.dueOn, escalationLevel: r.escalationLevel,
    escalatedToName: r.escalatedToId ? nameById.get(r.escalatedToId) ?? null : null,
    verifiable: r.verifiable, manualDoneCount: r.manualDoneCount, since: r.firstSeenAt.toISOString(),
    href: `/controle/${r.id}`,
  })).sort((a, b) =>
    b.escalationLevel - a.escalationLevel ||
    (a.severity === "rood" ? 0 : 1) - (b.severity === "rood" ? 0 : 1) ||
    (a.dueOn ?? "9").localeCompare(b.dueOn ?? "9"));

  // Niet-leidinggevenden zien alleen hun eigen punten.
  const isLead = viewer.id === people.leadId || viewer.id === people.backupId;
  const teamView = ops || isOwner(viewer) || isLead || isCoreStaff(viewer.email);
  const visible = teamView ? items : items.filter((i) => i.ownerId === viewer.id);

  const res = { auto: 0, manual: 0 };
  for (const r of resolved) {
    if (r.resolution === "manual") res.manual += Number(r.n);
    else res.auto += Number(r.n);
  }

  const coreIds = new Set(staff.map((s) => s.id));
  const gaps = {
    coordinator: activeClients.filter((c) => !c.coordinatorId || !coreIds.has(c.coordinatorId)).map((c) => c.name).sort(),
    videographer: activeClients.filter((c) => !c.videographerId).map((c) => c.name).sort(),
    editor: activeClients.filter((c) => !c.editorName?.trim()).map((c) => c.name).sort(),
  };

  return {
    today,
    lastRun: last ? { at: (last.finishedAt ?? last.startedAt).toISOString(), slot: last.slot, status: last.status } : null,
    lastScheduledRun: lastScheduled ? { at: (lastScheduled.finishedAt ?? lastScheduled.startedAt).toISOString(), slot: lastScheduled.slot } : null,
    checkedToday: last?.runDate === today,
    health: summary?.domains ?? [],
    items: visible,
    resolvedToday: res,
    people: staff.sort((a, b) => coreStaffRank(a.email) - coreStaffRank(b.email)).map((s) => ({ id: s.id, name: firstName(s.fullName) })),
    gaps,
    me: viewer.id,
    leadName: people.leadId ? nameById.get(people.leadId) ?? null : null,
    isLead,
    canRun: ops || isOwner(viewer) || isLead,
    defaultScope: isOwner(viewer) || ops || isLead ? "team" : "mine",
    times: { morning: settings.morning, midday: settings.midday, afternoon: settings.afternoon },
    enabled: settings.enabled,
  };
}
