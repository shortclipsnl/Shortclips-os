import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  deliverables,
  editorMeetingActions,
  editorMeetingItems,
  editorMeetingOwners,
  editorMeetingPoints,
  editorMeetings,
  tasks,
  users,
  type EditorMeetingReport,
} from "@/db/schema";
import { ForbiddenError, isEditorRole, isOwner, type Viewer } from "@/server/auth/context";
import { isCoreStaff } from "@/server/core-staff";
import { clearByDedupe, notify } from "@/server/notifications";
import { runJob } from "@/server/jobs/runner";
import { todayAmsterdam } from "@/lib/planning-deadline";
import {
  ACTION_TASK_PREFIX,
  EDITOR_MEETING_OWNER_EMAILS,
  MAX_ITEM_LENGTH,
  MAX_OPEN_ITEMS,
  OWNER_TYPES,
  PLAN_TASK_PREFIX,
  POINT_KINDS,
  REPORT_GRACE_DAYS,
  addPeriods,
  amsterdamToDate,
  cleanTheme,
  displayStatus,
  draftAgenda,
  editorHistoryRange,
  isItemOutcome,
  itemStateForEditor,
  googleCalendarUrl,
  isMeetingOwnerEmail,
  isOverdue,
  lastDayOfPeriod,
  meetingMoment,
  meetingMomentShort,
  monthLabel,
  nextPeriod,
  parsePlanTaskKey,
  periodOf,
  planTaskDescription,
  planTaskKey,
  planTaskTitle,
  planningPeriods,
  prevPeriod,
  recurringThemes,
  reminderStage,
  sharedShortclipsThemes,
  themeLabel,
  type DisplayStatus,
  type ItemOutcome,
  type OwnerType,
  type PlanLine,
  type PointKind,
  type RecurringTheme,
} from "@/lib/editor-meetings";

/**
 * Editor Meetings: het maandelijkse gesprek tussen een editor en de
 * verantwoordelijke content creator.
 *
 * Toegang (overal op de server afgedwongen, niet alleen in het menu):
 *  - editor:           alleen eigen meetings, alleen gepubliceerde verslagen,
 *                      nooit interne notities;
 *  - Milou en Jiska:   plannen en verslagen voor de editors waarvoor zij
 *                      verantwoordelijk zijn; het centrale overzicht toont van
 *                      de andere editors alleen de planning;
 *  - management:       alles.
 */

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const OPEN_TASK = ["todo", "in_progress", "blocked"] as const;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/* -------------------------------- toegang -------------------------------- */

export function isMeetingManagement(viewer: Viewer | null): boolean {
  return !!viewer && !viewer.isPortalUser && (isOwner(viewer) || viewer.primaryRole === "admin");
}

/** Content creator die editor meetings voert (Milou, Jiska). */
export function isMeetingOwner(viewer: Viewer | null): boolean {
  return !!viewer && !viewer.isPortalUser && !isEditorRole(viewer) && isMeetingOwnerEmail(viewer.email);
}

/** Het interne overzicht: management en de content creators, nooit editors. */
export function canUseTeamView(viewer: Viewer | null): boolean {
  if (!viewer || viewer.isPortalUser || isEditorRole(viewer)) return false;
  return isMeetingManagement(viewer) || isMeetingOwner(viewer);
}

export function canUseEditorMeetings(viewer: Viewer | null): boolean {
  if (!viewer || viewer.isPortalUser) return false;
  return isEditorRole(viewer) || canUseTeamView(viewer);
}

/** Mag deze kijker de meetings en verslagen van een editor beheren? */
function mayManage(viewer: Viewer, ownerId: string | null, meetingOwnerId?: string | null): boolean {
  if (isMeetingManagement(viewer)) return true;
  if (!isMeetingOwner(viewer)) return false;
  return ownerId === viewer.id || (!!meetingOwnerId && meetingOwnerId === viewer.id);
}

/* -------------------------------- personen -------------------------------- */

export type Person = { id: string; fullName: string; avatarUrl: string | null; email: string };

/**
 * Actieve editors: elk actief portaalaccount met de rol editor. Een nieuwe
 * editor doet daardoor vanzelf mee zodra het account actief is; een editor die
 * op niet actief staat valt er vanzelf uit.
 */
export async function listActiveEditors(): Promise<Person[]> {
  const list = await db
    .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl, email: users.email })
    .from(users)
    .where(and(eq(users.primaryRole, "editor"), eq(users.status, "active"), isNull(users.deletedAt)))
    .orderBy(asc(users.fullName));
  return list.filter((u) => !isCoreStaff(u.email));
}

export async function listMeetingOwners(): Promise<Person[]> {
  const list = await db
    .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl, email: users.email })
    .from(users)
    .where(and(eq(users.status, "active"), isNull(users.deletedAt), inArray(sql`lower(${users.email})`, [...EDITOR_MEETING_OWNER_EMAILS])));
  const rank = (e: string) => (EDITOR_MEETING_OWNER_EMAILS as readonly string[]).indexOf(e.toLowerCase());
  return list.sort((a, b) => rank(a.email) - rank(b.email));
}

export type OwnerInfo = { ownerId: string | null; source: "vast" | "voorstel" | null };

/**
 * Wie is de verantwoordelijke content creator van elke editor?
 *  - "vast": bevestigd in het portaal;
 *  - "voorstel": afgeleid uit de klanten waar de editor het afgelopen halfjaar
 *    voor werkte (de coördinator met de meeste projecten);
 *  - null: nog niemand.
 */
export async function getOwnerMap(editorIds: string[], owners?: Person[]): Promise<Map<string, OwnerInfo>> {
  const out = new Map<string, OwnerInfo>();
  for (const id of editorIds) out.set(id, { ownerId: null, source: null });
  if (editorIds.length === 0) return out;
  const ownerList = owners ?? (await listMeetingOwners());
  const ownerIds = ownerList.map((o) => o.id);
  if (ownerIds.length === 0) return out;

  const explicit = await db
    .select({ editorId: editorMeetingOwners.editorId, ownerId: editorMeetingOwners.ownerId })
    .from(editorMeetingOwners)
    .where(inArray(editorMeetingOwners.editorId, editorIds));
  for (const r of explicit) if (ownerIds.includes(r.ownerId)) out.set(r.editorId, { ownerId: r.ownerId, source: "vast" });

  const open = editorIds.filter((id) => out.get(id)!.source === null);
  if (open.length === 0) return out;
  const since = new Date(Date.now() - 180 * 86_400_000);
  const derived = await db
    .select({ editorId: deliverables.editorId, ownerId: clients.coordinatorId, n: sql<number>`count(*)::int` })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .where(and(isNull(deliverables.deletedAt), inArray(deliverables.editorId, open), inArray(clients.coordinatorId, ownerIds), gte(deliverables.updatedAt, since)))
    .groupBy(deliverables.editorId, clients.coordinatorId);
  const best = new Map<string, { ownerId: string; n: number }>();
  for (const r of derived) {
    if (!r.editorId || !r.ownerId) continue;
    const cur = best.get(r.editorId);
    const better = !cur || r.n > cur.n || (r.n === cur.n && ownerIds.indexOf(r.ownerId) < ownerIds.indexOf(cur.ownerId));
    if (better) best.set(r.editorId, { ownerId: r.ownerId, n: Number(r.n) });
  }
  for (const [editorId, b] of best) out.set(editorId, { ownerId: b.ownerId, source: "voorstel" });
  return out;
}

/** Legt de verantwoordelijke content creator van een editor vast. */
export async function setEditorOwner(viewer: Viewer, editorId: string, ownerId: string): Promise<void> {
  if (!canUseTeamView(viewer)) throw new ForbiddenError("Dit onderdeel is alleen voor Team Shortclips.");
  const owners = await listMeetingOwners();
  if (!owners.some((o) => o.id === ownerId)) throw new ForbiddenError("Kies Milou of Jiska als verantwoordelijke.");
  const editors = await listActiveEditors();
  if (!editors.some((e) => e.id === editorId)) throw new ForbiddenError("Deze editor is niet actief.");
  if (!isMeetingManagement(viewer)) {
    // Een content creator mag een voorstel bevestigen of een editor zonder
    // verantwoordelijke oppakken; een vaste verdeling wijzigen kan alleen management.
    const current = (await getOwnerMap([editorId], owners)).get(editorId)!;
    if (current.source === "vast" && current.ownerId !== viewer.id) throw new ForbiddenError("De verdeling van editors wijzigen kan alleen het management.");
  }
  await db
    .insert(editorMeetingOwners)
    .values({ editorId, ownerId, setById: viewer.id })
    .onConflictDoUpdate({ target: editorMeetingOwners.editorId, set: { ownerId, setById: viewer.id, updatedAt: new Date() } });
  // Nog niet gehouden meetings verhuizen mee naar de nieuwe verantwoordelijke.
  await db
    .update(editorMeetings)
    .set({ ownerId, updatedAt: new Date() })
    .where(and(eq(editorMeetings.editorId, editorId), ne(editorMeetings.reportStatus, "gepubliceerd"), gte(editorMeetings.period, periodOf(todayAmsterdam()))));
  await syncPlanTasks();
}

/* ------------------------------ weergavetypes ------------------------------ */

export type ActionState = "concept" | "open" | "afgerond" | "vervallen";

export type ActionView = {
  id: string;
  meetingId: string;
  period: string;
  body: string;
  ownerType: OwnerType;
  assigneeId: string | null;
  assigneeName: string | null;
  dueOn: string | null;
  state: ActionState;
  canToggle: boolean;
};

export type PointView = {
  id: string;
  meetingId: string;
  period: string;
  kind: PointKind;
  theme: string;
  themeLabel: string;
  body: string;
  example: string | null;
  status: string;
};

type MeetingRow = typeof editorMeetings.$inferSelect;

function actionState(taskId: string | null, taskStatus: string | null, taskDeleted: Date | null): ActionState {
  if (!taskId || !taskStatus) return "concept";
  if (taskDeleted || taskStatus === "cancelled") return "vervallen";
  return taskStatus === "done" ? "afgerond" : "open";
}

async function loadActions(where: ReturnType<typeof and>, viewer: Viewer, manageable: (editorId: string) => boolean): Promise<ActionView[]> {
  const list = await db
    .select({
      id: editorMeetingActions.id,
      meetingId: editorMeetingActions.meetingId,
      editorId: editorMeetingActions.editorId,
      period: editorMeetings.period,
      body: editorMeetingActions.body,
      ownerType: editorMeetingActions.ownerType,
      assigneeId: editorMeetingActions.assigneeId,
      assigneeName: users.fullName,
      dueOn: editorMeetingActions.dueOn,
      taskId: editorMeetingActions.taskId,
      taskStatus: tasks.status,
      taskDeleted: tasks.deletedAt,
    })
    .from(editorMeetingActions)
    .innerJoin(editorMeetings, eq(editorMeetings.id, editorMeetingActions.meetingId))
    .leftJoin(users, eq(users.id, editorMeetingActions.assigneeId))
    .leftJoin(tasks, eq(tasks.id, editorMeetingActions.taskId))
    .where(where)
    .orderBy(asc(editorMeetings.period), asc(editorMeetingActions.sortOrder), asc(editorMeetingActions.createdAt));
  return list.map((a) => {
    const state = actionState(a.taskId, a.taskStatus, a.taskDeleted);
    return {
      id: a.id,
      meetingId: a.meetingId,
      period: a.period,
      body: a.body,
      ownerType: (OWNER_TYPES as readonly string[]).includes(a.ownerType) ? (a.ownerType as OwnerType) : "editor",
      assigneeId: a.assigneeId,
      assigneeName: a.assigneeName,
      dueOn: a.dueOn,
      state,
      canToggle: (state === "open" || state === "afgerond") && (a.assigneeId === viewer.id || manageable(a.editorId)),
    };
  });
}

async function loadPoints(where: ReturnType<typeof and>): Promise<PointView[]> {
  const list = await db
    .select({
      id: editorMeetingPoints.id,
      meetingId: editorMeetingPoints.meetingId,
      period: editorMeetings.period,
      kind: editorMeetingPoints.kind,
      theme: editorMeetingPoints.theme,
      body: editorMeetingPoints.body,
      example: editorMeetingPoints.example,
      status: editorMeetingPoints.status,
    })
    .from(editorMeetingPoints)
    .innerJoin(editorMeetings, eq(editorMeetings.id, editorMeetingPoints.meetingId))
    .where(where)
    .orderBy(asc(editorMeetings.period), asc(editorMeetingPoints.sortOrder), asc(editorMeetingPoints.createdAt));
  return list.map((p) => ({ ...p, kind: p.kind as PointKind, themeLabel: themeLabel(p.kind, p.theme) }));
}

/* ------------------------------ teamoverzicht ------------------------------ */

export type OverviewRow = {
  editor: Person;
  owner: Person | null;
  ownerSource: OwnerInfo["source"];
  canManage: boolean;
  meetingId: string | null;
  scheduledAt: Date | null;
  status: DisplayStatus;
  overdue: boolean;
  reportPublished: boolean;
  lastMeeting: { id: string; at: Date } | null;
  nextMeeting: { id: string; at: Date } | null;
  openActions: number;
  /** Open bespreekpunten die de editor zelf heeft klaargezet. */
  openItems: number;
};

export type Overview = {
  period: string;
  rows: OverviewRow[];
  owners: Person[];
  isManagement: boolean;
  viewerIsOwner: boolean;
};

export async function getOverview(viewer: Viewer, period: string, now = new Date()): Promise<Overview> {
  if (!canUseTeamView(viewer)) throw new ForbiddenError("Dit onderdeel is alleen voor Team Shortclips.");
  const today = todayAmsterdam(now);
  const [editors, owners] = await Promise.all([listActiveEditors(), listMeetingOwners()]);
  const ids = editors.map((e) => e.id);
  const ownerMap = await getOwnerMap(ids, owners);
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const meetings = ids.length ? await db.select().from(editorMeetings).where(inArray(editorMeetings.editorId, ids)) : [];
  const openCounts = ids.length
    ? await db
        .select({ editorId: editorMeetingActions.editorId, n: sql<number>`count(*)::int` })
        .from(editorMeetingActions)
        .innerJoin(editorMeetings, eq(editorMeetings.id, editorMeetingActions.meetingId))
        .innerJoin(tasks, eq(tasks.id, editorMeetingActions.taskId))
        .where(and(inArray(editorMeetingActions.editorId, ids), eq(editorMeetings.reportStatus, "gepubliceerd"), inArray(tasks.status, [...OPEN_TASK]), isNull(tasks.deletedAt)))
        .groupBy(editorMeetingActions.editorId)
    : [];
  const openByEditor = new Map(openCounts.map((r) => [r.editorId, Number(r.n)]));
  const itemCounts = ids.length
    ? await db
        .select({ editorId: editorMeetingItems.editorId, n: sql<number>`count(*)::int` })
        .from(editorMeetingItems)
        .where(and(inArray(editorMeetingItems.editorId, ids), eq(editorMeetingItems.status, "open")))
        .groupBy(editorMeetingItems.editorId)
    : [];
  const itemsByEditor = new Map(itemCounts.map((r) => [r.editorId, Number(r.n)]));

  const list: OverviewRow[] = editors.map((editor) => {
    const info = ownerMap.get(editor.id)!;
    const mine = meetings.filter((m) => m.editorId === editor.id);
    const current = mine.find((m) => m.period === period) ?? null;
    const held = mine
      .filter((m) => m.status === "gepland" && m.scheduledAt && new Date(m.scheduledAt).getTime() <= now.getTime())
      .sort((a, b) => new Date(b.scheduledAt!).getTime() - new Date(a.scheduledAt!).getTime())[0];
    const upcoming = mine
      .filter((m) => m.status === "gepland" && m.scheduledAt && new Date(m.scheduledAt).getTime() > now.getTime())
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())[0];
    return {
      editor,
      owner: info.ownerId ? ownerById.get(info.ownerId) ?? null : null,
      ownerSource: info.source,
      canManage: mayManage(viewer, info.ownerId, current?.ownerId),
      meetingId: current?.id ?? null,
      scheduledAt: current?.status === "gepland" && current.scheduledAt ? new Date(current.scheduledAt) : null,
      status: displayStatus(current, period, now, today),
      overdue: isOverdue(current, period, now, today),
      reportPublished: current?.reportStatus === "gepubliceerd",
      lastMeeting: held ? { id: held.id, at: new Date(held.scheduledAt!) } : null,
      nextMeeting: upcoming ? { id: upcoming.id, at: new Date(upcoming.scheduledAt!) } : null,
      openActions: openByEditor.get(editor.id) ?? 0,
      openItems: itemsByEditor.get(editor.id) ?? 0,
    };
  });
  return { period, rows: list, owners, isManagement: isMeetingManagement(viewer), viewerIsOwner: isMeetingOwner(viewer) };
}

export type Insights = {
  /** Verbeterpunten die bij een editor meerdere maanden terugkomen. */
  recurring: { editor: Person; themes: (RecurringTheme & { label: string })[] }[];
  /** Feedback op Shortclips die van meerdere editors komt: een intern verbeterpunt. */
  shared: { theme: string; label: string; editors: number; names: string[]; examples: string[] }[];
  /** Recent vastgelegde sterke punten. */
  strengths: { editor: Person; body: string; period: string }[];
};

export async function getInsights(viewer: Viewer, now = new Date()): Promise<Insights> {
  if (!canUseTeamView(viewer)) throw new ForbiddenError("Dit onderdeel is alleen voor Team Shortclips.");
  const current = periodOf(todayAmsterdam(now));
  const editors = await listActiveEditors();
  const ownerMap = await getOwnerMap(editors.map((e) => e.id));
  const byId = new Map(editors.map((e) => [e.id, e]));
  const manageable = (id: string) => mayManage(viewer, ownerMap.get(id)?.ownerId ?? null);
  if (editors.length === 0) return { recurring: [], shared: [], strengths: [] };

  const points = await db
    .select({ editorId: editorMeetingPoints.editorId, kind: editorMeetingPoints.kind, theme: editorMeetingPoints.theme, body: editorMeetingPoints.body, period: editorMeetings.period })
    .from(editorMeetingPoints)
    .innerJoin(editorMeetings, eq(editorMeetings.id, editorMeetingPoints.meetingId))
    .where(and(inArray(editorMeetingPoints.editorId, editors.map((e) => e.id)), eq(editorMeetings.reportStatus, "gepubliceerd"), gte(editorMeetings.period, addPeriods(current, -5))))
    .orderBy(desc(editorMeetings.period));

  const recurring: Insights["recurring"] = [];
  for (const editor of editors) {
    if (!manageable(editor.id)) continue;
    const themes = recurringThemes(points.filter((p) => p.editorId === editor.id && p.kind === "verbeterpunt"));
    if (themes.length) recurring.push({ editor, themes: themes.map((t) => ({ ...t, label: themeLabel("verbeterpunt", t.theme) })) });
  }

  const recentShortclips = points.filter((p) => p.kind === "shortclips" && p.period >= addPeriods(current, -2));
  const shared = sharedShortclipsThemes(recentShortclips).map((s) => ({
    theme: s.theme,
    label: themeLabel("shortclips", s.theme),
    editors: s.editors,
    names: s.editorIds.filter(manageable).map((id) => firstName(byId.get(id)?.fullName ?? "")).filter(Boolean),
    examples: recentShortclips.filter((p) => p.theme === s.theme && manageable(p.editorId)).map((p) => p.body).slice(0, 3),
  }));

  const strengths = points
    .filter((p) => p.kind === "sterk" && p.period >= addPeriods(current, -1) && manageable(p.editorId))
    .slice(0, 6)
    .map((p) => ({ editor: byId.get(p.editorId)!, body: p.body, period: p.period }));
  return { recurring, shared, strengths };
}

/* ------------------------------ voorbereiding ------------------------------ */

export type Preparation = {
  reviewPeriod: string;
  delivered: { projects: number; shorts: number | null; byClient: { name: string; projects: number; shorts: number | null }[] };
  avgFeedbackRounds: number | null;
  feedbackSample: number;
  avgLeadDays: number | null;
  leadSample: number;
  missedDeadlines: { title: string; client: string | null; dueOn: string; daysLate: number }[];
  openFeedback: { title: string; client: string; status: string }[];
  highlights: string[];
};

/**
 * Voorbereiding uit de gegevens die al in het portaal staan, over de maand die
 * besproken wordt. Cijfers verschijnen alleen als ze er echt zijn: een leeg
 * gemiddelde blijft leeg en wordt nooit geschat.
 */
export async function getPreparation(editorId: string, reviewPeriod: string): Promise<Preparation> {
  const start = `${reviewPeriod}-01`;
  const end = `${nextPeriod(reviewPeriod)}-01`;
  const [doneRes, missRes, openRes] = await Promise.all([
    db.execute(sql`
      select c.name as client, d.planned_shorts as shorts, d.feedback_rounds as rounds,
        ((coalesce(d.approved_at, d.published_at) at time zone 'Europe/Amsterdam')::date - coalesce(pd.scheduled_on, d.shoot_on)) as lead_days
      from deliverables d
      join clients c on c.id = d.client_id
      left join production_days pd on pd.id = d.production_day_id
      where d.editor_id = ${editorId} and d.deleted_at is null
        and coalesce(d.approved_at, d.published_at) is not null
        and (coalesce(d.approved_at, d.published_at) at time zone 'Europe/Amsterdam')::date >= ${start}::date
        and (coalesce(d.approved_at, d.published_at) at time zone 'Europe/Amsterdam')::date < ${end}::date
    `),
    db.execute(sql`
      select dm.title as title, c.name as client, dm.due_on as due_on, dm.days_late as days_late
      from deadline_misses dm
      left join clients c on c.id = dm.client_id
      where dm.responsible_user_id = ${editorId} and dm.entity_type = 'deliverable'
        and dm.due_on >= ${start}::date and dm.due_on < ${end}::date
      order by dm.due_on
    `),
    db.execute(sql`
      select d.title as title, c.name as client, d.status as status
      from deliverables d
      join clients c on c.id = d.client_id
      where d.editor_id = ${editorId} and d.deleted_at is null and d.status in ('editor_revision', 'client_revision')
      order by d.status_changed_at
    `),
  ]);

  const done = rows<{ client: string; shorts: number | null; rounds: number | null; lead_days: number | null }>(doneRes);
  const byClient = new Map<string, { projects: number; shorts: number | null }>();
  for (const d of done) {
    const cur = byClient.get(d.client) ?? { projects: 0, shorts: null };
    cur.projects += 1;
    if (d.shorts != null) cur.shorts = (cur.shorts ?? 0) + Number(d.shorts);
    byClient.set(d.client, cur);
  }
  const shortsKnown = done.filter((d) => d.shorts != null);
  const leads = done.map((d) => (d.lead_days == null ? null : Number(d.lead_days))).filter((v): v is number => v != null && v >= 0);
  const avg = (list: number[]) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);
  const missed = rows<{ title: string | null; client: string | null; due_on: string; days_late: number }>(missRes).map((m) => ({
    title: m.title ?? "Project",
    client: m.client,
    dueOn: String(m.due_on).slice(0, 10),
    daysLate: Number(m.days_late ?? 0),
  }));
  // Feedbackrondes worden handmatig bijgehouden op Editing en staan standaard op 0.
  // Staat overal 0, dan is niet te zeggen of er geen rondes waren of dat ze niet
  // zijn ingevuld: het gemiddelde blijft dan leeg in plaats van "0".
  const rounds = done.map((d) => Number(d.rounds ?? 0));
  const avgRounds = rounds.some((v) => v > 0) ? avg(rounds) : null;

  const highlights: string[] = [];
  if (done.length >= 3 && missed.length === 0) highlights.push(`Alle deadlines gehaald bij ${done.length} opgeleverde projecten.`);
  if (missed.length >= 2) highlights.push(`${missed.length} deadlines gemist in ${monthLabel(reviewPeriod)}.`);
  if (done.length >= 3 && avgRounds != null && avgRounds <= 1) highlights.push(`Gemiddeld ${String(avgRounds).replace(".", ",")} feedbackrondes per project: binnen de ene ronde die standaard is.`);
  if (done.length >= 3 && avgRounds != null && avgRounds >= 2) highlights.push(`Gemiddeld ${String(avgRounds).replace(".", ",")} feedbackrondes per project: meer dan de ene ronde die standaard is.`);

  return {
    reviewPeriod,
    delivered: {
      projects: done.length,
      shorts: shortsKnown.length ? shortsKnown.reduce((a, d) => a + Number(d.shorts), 0) : null,
      byClient: [...byClient.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.projects - a.projects),
    },
    avgFeedbackRounds: avgRounds,
    feedbackSample: done.length,
    avgLeadDays: avg(leads),
    leadSample: leads.length,
    missedDeadlines: missed,
    openFeedback: rows<{ title: string; client: string; status: string }>(openRes),
    highlights,
  };
}

/* ------------------------------ meetingdetail ------------------------------ */

export type MeetingView = {
  id: string;
  editorId: string;
  period: string;
  scheduledAt: Date | null;
  durationMinutes: number;
  location: string | null;
  meetingUrl: string | null;
  topics: string[];
  status: string;
  reportStatus: string;
  report: EditorMeetingReport;
  /** Alleen in de teamweergave; voor editors altijd null. */
  internalNotes: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  display: DisplayStatus;
  overdue: boolean;
};

export type MeetingDetail = {
  mode: "editor" | "team";
  meeting: MeetingView;
  editor: Person;
  owner: Person | null;
  points: PointView[];
  actions: ActionView[];
  /** Openstaande verbeterpunten en actiepunten uit eerdere meetings. */
  earlierPoints: PointView[];
  earlierActions: ActionView[];
  previous: { id: string; period: string; scheduledAt: Date | null; report: EditorMeetingReport; points: PointView[]; actions: ActionView[] } | null;
  recurring: (RecurringTheme & { label: string })[];
  preparation: Preparation | null;
  agendaDraft: string[];
  calendarUrl: string | null;
  assignees: { id: string; fullName: string }[];
  /**
   * Eigen bespreekpunten van de editor. Team: de open punten (zolang het
   * verslag niet is gepubliceerd) en de punten die in deze meeting zijn
   * behandeld. Editor: alleen de behandelde punten van een gepubliceerd verslag.
   */
  items: ItemView[];
};

function toView(m: MeetingRow, now: Date, forEditor: boolean): MeetingView {
  const today = todayAmsterdam(now);
  const published = m.reportStatus === "gepubliceerd";
  return {
    id: m.id,
    editorId: m.editorId,
    period: m.period,
    scheduledAt: m.scheduledAt ? new Date(m.scheduledAt) : null,
    durationMinutes: m.durationMinutes,
    location: m.location,
    meetingUrl: m.meetingUrl,
    topics: Array.isArray(m.topics) ? m.topics : [],
    status: m.status,
    // Een conceptverslag bestaat voor de editor niet.
    reportStatus: forEditor && !published ? "geen" : m.reportStatus,
    report: forEditor && !published ? {} : m.report ?? {},
    internalNotes: forEditor ? null : m.internalNotes,
    publishedAt: m.publishedAt ? new Date(m.publishedAt) : null,
    updatedAt: new Date(m.updatedAt),
    display: displayStatus(m, m.period, now, today),
    overdue: isOverdue(m, m.period, now, today),
  };
}

async function personById(id: string | null): Promise<Person | null> {
  if (!id) return null;
  const [u] = await db.select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  return u ?? null;
}

export async function getMeetingDetail(viewer: Viewer, meetingId: string, now = new Date()): Promise<MeetingDetail | null> {
  if (!canUseEditorMeetings(viewer)) throw new ForbiddenError();
  const [m] = await db.select().from(editorMeetings).where(eq(editorMeetings.id, meetingId)).limit(1);
  if (!m) return null;

  const asEditor = isEditorRole(viewer);
  const ownerInfo = (await getOwnerMap([m.editorId])).get(m.editorId)!;
  if (asEditor) {
    if (m.editorId !== viewer.id) throw new ForbiddenError("Dit is niet jouw meeting.");
  } else if (!mayManage(viewer, ownerInfo.ownerId, m.ownerId)) {
    throw new ForbiddenError("Deze editor valt niet onder jouw verantwoordelijkheid.");
  }

  const manageable = () => !asEditor;
  const publishedOnly = asEditor ? eq(editorMeetings.reportStatus, "gepubliceerd") : undefined;
  const [editor, owner, points, actions, earlierPointsAll, earlierActionsAll, prevRows] = await Promise.all([
    personById(m.editorId),
    personById(m.ownerId ?? ownerInfo.ownerId),
    loadPoints(and(eq(editorMeetingPoints.meetingId, m.id), publishedOnly)),
    loadActions(and(eq(editorMeetingActions.meetingId, m.id), publishedOnly), viewer, manageable),
    loadPoints(and(eq(editorMeetingPoints.editorId, m.editorId), ne(editorMeetingPoints.meetingId, m.id), eq(editorMeetings.reportStatus, "gepubliceerd"), sql`${editorMeetings.period} < ${m.period}`)),
    loadActions(and(eq(editorMeetingActions.editorId, m.editorId), ne(editorMeetingActions.meetingId, m.id), eq(editorMeetings.reportStatus, "gepubliceerd"), sql`${editorMeetings.period} < ${m.period}`), viewer, manageable),
    db
      .select()
      .from(editorMeetings)
      .where(and(eq(editorMeetings.editorId, m.editorId), eq(editorMeetings.reportStatus, "gepubliceerd"), sql`${editorMeetings.period} < ${m.period}`))
      .orderBy(desc(editorMeetings.period))
      .limit(1),
  ]);
  if (!editor) return null;

  const prev = prevRows[0] ?? null;
  const previous = prev
    ? {
        id: prev.id,
        period: prev.period,
        scheduledAt: prev.scheduledAt ? new Date(prev.scheduledAt) : null,
        report: prev.report ?? {},
        points: earlierPointsAll.filter((p) => p.meetingId === prev.id),
        actions: earlierActionsAll.filter((a) => a.meetingId === prev.id),
      }
    : null;
  const earlierPoints = earlierPointsAll.filter((p) => (p.kind === "verbeterpunt" || p.kind === "vaardigheid") && p.status === "open");
  const earlierActions = earlierActionsAll.filter((a) => a.state === "open");
  const recurring = recurringThemes(earlierPointsAll.filter((p) => p.kind === "verbeterpunt").map((p) => ({ theme: p.theme, period: p.period }))).map((t) => ({
    ...t,
    label: themeLabel("verbeterpunt", t.theme),
  }));

  const reviewPeriod = prevPeriod(m.period);
  const preparation = asEditor ? null : await getPreparation(m.editorId, reviewPeriod);
  const agendaDraft = asEditor
    ? []
    : draftAgenda({
        reviewPeriod,
        delivered: preparation!.delivered.projects,
        missedDeadlines: preparation!.missedDeadlines.length,
        openFeedback: preparation!.openFeedback.length,
        openActions: earlierActions.map((a) => a.body),
        openPoints: earlierPoints.filter((p) => p.kind === "verbeterpunt").map((p) => ({ theme: p.theme, body: p.body })),
        recurring,
      });

  const view = toView(m, now, asEditor);
  const calendarUrl =
    view.scheduledAt && m.status === "gepland"
      ? googleCalendarUrl({
          title: asEditor ? `Editor meeting met ${firstName(owner?.fullName ?? "Shortclips")}` : `Editor meeting ${firstName(editor.fullName)}`,
          start: view.scheduledAt,
          minutes: m.durationMinutes,
          location: m.meetingUrl || m.location,
          details: view.topics.length ? `Bespreekpunten:\n${view.topics.map((t) => `- ${t}`).join("\n")}` : undefined,
        })
      : null;

  let assignees: { id: string; fullName: string }[] = [];
  if (!asEditor) {
    const staff = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(and(eq(users.status, "active"), isNull(users.deletedAt)));
    assignees = staff.filter((u) => isCoreStaff(u.email)).map((u) => ({ id: u.id, fullName: u.fullName }));
  }

  const items = asEditor
    ? m.reportStatus === "gepubliceerd"
      ? await loadItems(and(eq(editorMeetingItems.editorId, m.editorId), eq(editorMeetingItems.meetingId, m.id)))
      : []
    : await loadItems(
        and(
          eq(editorMeetingItems.editorId, m.editorId),
          m.reportStatus === "gepubliceerd" ? eq(editorMeetingItems.meetingId, m.id) : or(eq(editorMeetingItems.status, "open"), eq(editorMeetingItems.meetingId, m.id)),
        ),
      );

  return { mode: asEditor ? "editor" : "team", meeting: view, editor, owner, points, actions, earlierPoints, earlierActions, previous, recurring, preparation, agendaDraft, calendarUrl, assignees, items };
}

/* ------------------------------ editorportaal ------------------------------ */

export type EditorPage = {
  owner: Person | null;
  /** True als de verantwoordelijke vastligt; false als het een voorstel uit de klantprojecten is. */
  ownerFixed: boolean;
  next: MeetingView | null;
  /** De maand van de eerstvolgende meeting, ook als die nog niet is ingepland. */
  target: { period: string; meetingId: string | null };
  nextCalendarUrl: string | null;
  openPoints: PointView[];
  openActions: ActionView[];
  /** Eigen bespreekpunten: open (en in behandeling) en de recent besproken punten. */
  items: { open: ItemView[]; handled: ItemView[] };
  history: { period: string; status: DisplayStatus; meetingId: string | null; scheduledAt: Date | null; hasReport: boolean; ownerName: string | null }[];
  development: {
    achieved: PointView[];
    recurring: (RecurringTheme & { label: string })[];
    strengths: PointView[];
    skills: PointView[];
    actionsDone: number;
    actionsTotal: number;
  };
};

/** Alles voor de eigen pagina van een editor. Uitsluitend gepubliceerde verslagen. */
export async function getEditorPage(viewer: Viewer, now = new Date()): Promise<EditorPage> {
  const editorId = viewer.id;
  const today = todayAmsterdam(now);
  const current = periodOf(today);
  const published = eq(editorMeetings.reportStatus, "gepubliceerd");
  const [meetings, points, actions, owners, items] = await Promise.all([
    db.select().from(editorMeetings).where(eq(editorMeetings.editorId, editorId)).orderBy(asc(editorMeetings.period)),
    loadPoints(and(eq(editorMeetingPoints.editorId, editorId), published)),
    loadActions(and(eq(editorMeetingActions.editorId, editorId), published), viewer, () => false),
    listMeetingOwners(),
    loadItems(eq(editorMeetingItems.editorId, editorId)),
  ]);
  const ownerInfo = await getOwnerMap([editorId], owners);
  const currentOwnerId = ownerInfo.get(editorId)?.ownerId ?? null;
  const ownerName = (id: string | null) => (id ? owners.find((o) => o.id === id)?.fullName ?? null : null);

  const upcoming = meetings
    .filter((m) => m.status === "gepland" && m.scheduledAt && new Date(m.scheduledAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())[0];
  const target = nextTarget(meetings, now);
  const targetRow = target.meetingId ? meetings.find((x) => x.id === target.meetingId) : null;
  // Eén bron: de verantwoordelijke van de geplande meeting, anders de vaste
  // (of voorgestelde) verantwoordelijke van de editor.
  const owner = await personById(upcoming?.ownerId ?? targetRow?.ownerId ?? currentOwnerId);

  const history = editorHistoryRange(current, meetings[0]?.period ?? null, meetings[meetings.length - 1]?.period ?? null)
    .reverse()
    .map((period) => {
      const m = meetings.find((x) => x.period === period) ?? null;
      const status = displayStatus(m, period, now, today);
      // Komende maanden tonen de huidige verantwoordelijke, zodat een wijziging direct doorwerkt.
      const who = m?.ownerId ?? (period >= current ? currentOwnerId : null);
      return {
        period,
        status,
        meetingId: m?.id ?? null,
        scheduledAt: m?.status === "gepland" && m.scheduledAt ? new Date(m.scheduledAt) : null,
        hasReport: m?.reportStatus === "gepubliceerd",
        ownerName: status === "niet_gehouden" ? null : ownerName(who),
      };
    });

  const mine = actions.filter((a) => a.assigneeId === editorId);
  const counted = mine.filter((a) => a.state === "open" || a.state === "afgerond");
  const next = upcoming ? toView(upcoming, now, true) : null;
  const lastHandledMeeting = items
    .filter((i) => i.editorState === "behandeld" && i.period)
    .reduce<string | null>((acc, i) => (!acc || i.period! > acc ? i.period! : acc), null);
  return {
    owner,
    ownerFixed: ownerInfo.get(editorId)?.source === "vast" || !!upcoming?.ownerId,
    next,
    target: { period: target.period, meetingId: target.meetingId },
    nextCalendarUrl: next?.scheduledAt
      ? googleCalendarUrl({
          title: `Editor meeting met ${firstName(owner?.fullName ?? "Shortclips")}`,
          start: next.scheduledAt,
          minutes: next.durationMinutes,
          location: next.meetingUrl || next.location,
          details: next.topics.length ? `Bespreekpunten:\n${next.topics.map((t) => `- ${t}`).join("\n")}` : undefined,
        })
      : null,
    openPoints: points.filter((p) => p.kind === "verbeterpunt" && p.status === "open").reverse(),
    openActions: mine.filter((a) => a.state === "open"),
    items: {
      open: items.filter((i) => i.editorState !== "behandeld"),
      handled: items.filter((i) => i.editorState === "behandeld" && i.period === lastHandledMeeting),
    },
    history,
    development: {
      achieved: points.filter((p) => (p.kind === "verbeterpunt" || p.kind === "vaardigheid") && p.status === "behaald").reverse(),
      recurring: recurringThemes(points.filter((p) => p.kind === "verbeterpunt").map((p) => ({ theme: p.theme, period: p.period }))).map((t) => ({ ...t, label: themeLabel("verbeterpunt", t.theme) })),
      strengths: points.filter((p) => p.kind === "sterk").reverse().slice(0, 8),
      skills: points.filter((p) => p.kind === "vaardigheid" && p.status === "open").reverse(),
      actionsDone: counted.filter((a) => a.state === "afgerond").length,
      actionsTotal: counted.length,
    },
  };
}

/** Eerstvolgende meeting van een editor, voor de agenda-feed. */
export async function upcomingMeetingsForEditor(editorId: string, now = new Date()) {
  const list = await db
    .select({ id: editorMeetings.id, scheduledAt: editorMeetings.scheduledAt, durationMinutes: editorMeetings.durationMinutes, location: editorMeetings.location, meetingUrl: editorMeetings.meetingUrl, ownerName: users.fullName, updatedAt: editorMeetings.updatedAt })
    .from(editorMeetings)
    .leftJoin(users, eq(users.id, editorMeetings.ownerId))
    .where(and(eq(editorMeetings.editorId, editorId), eq(editorMeetings.status, "gepland"), gte(editorMeetings.scheduledAt, new Date(now.getTime() - 86_400_000))));
  return list.filter((m) => m.scheduledAt);
}

/** Geplande editor meetings van een content creator, voor "Agenda deze week" op Vandaag. */
export async function upcomingMeetingsForOwner(viewer: Viewer, days = 7, now = new Date()) {
  if (!isMeetingOwner(viewer)) return [];
  const until = new Date(now.getTime() + days * 86_400_000);
  const list = await db
    .select({ id: editorMeetings.id, scheduledAt: editorMeetings.scheduledAt, location: editorMeetings.location, editorName: users.fullName })
    .from(editorMeetings)
    .innerJoin(users, eq(users.id, editorMeetings.editorId))
    .where(and(eq(editorMeetings.ownerId, viewer.id), eq(editorMeetings.status, "gepland"), gte(editorMeetings.scheduledAt, new Date(now.getTime() - 2 * 3_600_000)), sql`${editorMeetings.scheduledAt} < ${until.toISOString()}::timestamptz`));
  return list
    .filter((m) => m.scheduledAt)
    .map((m) => ({ id: m.id, title: `Editor meeting ${firstName(m.editorName)}`, scheduledAt: new Date(m.scheduledAt!), location: m.location, href: `/editor-meetings/${m.id}` }));
}

/* --------------------------------- plannen --------------------------------- */

export type PlanInput = {
  meetingId?: string | null;
  editorId: string;
  date: string;
  time: string;
  durationMinutes?: number;
  location?: string | null;
  meetingUrl?: string | null;
  topics?: string[];
};

function cleanTopics(list: string[] | undefined): string[] {
  return (list ?? []).map((t) => t.trim().slice(0, 300)).filter(Boolean).slice(0, 20);
}

function cleanUrl(url: string | null | undefined): string | null {
  const v = url?.trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Meeting plannen of verplaatsen. Er bestaat per editor per maand precies één
 * meeting: opnieuw plannen in dezelfde maand werkt de bestaande rij bij, dus een
 * dubbele meeting kan niet ontstaan. Alle weergaven (editorportaal, portaal van
 * de content creator, centraal overzicht, agenda-feed) lezen dezelfde rij.
 */
export async function planMeeting(viewer: Viewer, input: PlanInput, now = new Date()): Promise<{ id: string }> {
  if (!canUseTeamView(viewer)) throw new ForbiddenError("Meetings plannen kan alleen Team Shortclips.");
  const at = amsterdamToDate(input.date, input.time);
  if (!at) throw new ForbiddenError("Kies een geldige datum en tijd.");
  const period = periodOf(input.date);
  if (period < periodOf(todayAmsterdam(now))) throw new ForbiddenError("Kies een datum in deze of een volgende maand.");

  const editors = await listActiveEditors();
  const editor = editors.find((e) => e.id === input.editorId);
  if (!editor) throw new ForbiddenError("Deze editor is niet actief.");
  const owners = await listMeetingOwners();
  let info = (await getOwnerMap([editor.id], owners)).get(editor.id)!;

  // Een content creator die plant voor een editor zonder vaste verantwoordelijke
  // wordt daarmee de verantwoordelijke (voorstel bevestigen of editor oppakken).
  if (!isMeetingManagement(viewer) && isMeetingOwner(viewer) && info.source !== "vast" && (info.ownerId === null || info.ownerId === viewer.id)) {
    await db
      .insert(editorMeetingOwners)
      .values({ editorId: editor.id, ownerId: viewer.id, setById: viewer.id })
      .onConflictDoNothing();
    info = { ownerId: viewer.id, source: "vast" };
  }
  if (!mayManage(viewer, info.ownerId)) throw new ForbiddenError("Deze editor valt niet onder jouw verantwoordelijkheid.");
  if (!info.ownerId) throw new ForbiddenError("Kies eerst wie de verantwoordelijke content creator van deze editor is.");
  const owner = owners.find((o) => o.id === info.ownerId)!;

  const values = {
    ownerId: info.ownerId,
    period,
    scheduledAt: at,
    durationMinutes: Math.min(240, Math.max(10, Math.round(input.durationMinutes ?? 30))),
    location: input.location?.trim().slice(0, 160) || null,
    meetingUrl: cleanUrl(input.meetingUrl),
    status: "gepland",
    updatedAt: new Date(),
  };
  const topics = input.topics ? cleanTopics(input.topics) : undefined;

  let existing: MeetingRow | null = null;
  if (input.meetingId) {
    const [row] = await db.select().from(editorMeetings).where(and(eq(editorMeetings.id, input.meetingId), eq(editorMeetings.editorId, editor.id))).limit(1);
    if (!row) throw new ForbiddenError("Meeting niet gevonden.");
    if (row.reportStatus === "gepubliceerd") throw new ForbiddenError("Deze meeting is afgerond en kan niet meer verplaatst worden.");
    existing = row;
    if (row.period !== period) {
      // Verplaatsen naar een andere maand: daar mag nog geen meeting staan.
      const [other] = await db.select().from(editorMeetings).where(and(eq(editorMeetings.editorId, editor.id), eq(editorMeetings.period, period))).limit(1);
      if (other) {
        const empty = other.reportStatus === "geen" && (other.status !== "gepland" || !other.scheduledAt);
        if (!empty) throw new ForbiddenError(`Er staat al een meeting in ${monthLabel(period)}. Pas die meeting aan.`);
        await db.delete(editorMeetings).where(eq(editorMeetings.id, other.id));
      }
    }
  } else {
    const [row] = await db.select().from(editorMeetings).where(and(eq(editorMeetings.editorId, editor.id), eq(editorMeetings.period, period))).limit(1);
    if (row?.reportStatus === "gepubliceerd") throw new ForbiddenError(`De meeting van ${monthLabel(period)} is al afgerond.`);
    existing = row ?? null;
  }

  let id: string;
  if (existing) {
    await db.update(editorMeetings).set({ ...values, ...(topics ? { topics } : {}) }).where(eq(editorMeetings.id, existing.id));
    id = existing.id;
  } else {
    const [created] = await db
      .insert(editorMeetings)
      .values({ editorId: editor.id, ...values, topics: topics ?? [], createdById: viewer.id })
      .onConflictDoUpdate({ target: [editorMeetings.editorId, editorMeetings.period], set: { ...values, ...(topics ? { topics } : {}) } })
      .returning({ id: editorMeetings.id });
    id = created!.id;
  }

  // Melding voor de editor. De oude melding (vorige datum) verdwijnt.
  const wasPlanned = !!existing && existing.status === "gepland" && !!existing.scheduledAt;
  const changed = !wasPlanned || new Date(existing!.scheduledAt!).getTime() !== at.getTime();
  if (changed) {
    if (wasPlanned) await clearByDedupe(`editormeeting:gepland:${id}:${new Date(existing!.scheduledAt!).toISOString()}`);
    await clearByDedupe(`editormeeting:geannuleerd:${id}`);
    const moment = meetingMoment(at);
    await notify({
      userIds: [editor.id],
      type: "editor_meeting.planned",
      level: "info",
      title: wasPlanned ? `Je editor meeting is verplaatst naar ${moment.charAt(0).toLowerCase()}${moment.slice(1)}` : `Editor meeting gepland: ${moment.charAt(0).toLowerCase()}${moment.slice(1)}`,
      body: `Met ${firstName(owner.fullName)}. Zet vooraf op je pagina Editor Meetings klaar wat jij wilt bespreken.`,
      href: "/editor-meetings",
      entityType: "editor_meeting",
      entityId: id,
      dedupeKey: `editormeeting:gepland:${id}:${at.toISOString()}`,
    });
    if (owner.id !== viewer.id) {
      await notify({
        userIds: [owner.id],
        type: "editor_meeting.planned",
        level: "info",
        title: `Editor meeting ${firstName(editor.fullName)}: ${meetingMomentShort(at)}`,
        body: `${wasPlanned ? "Verplaatst" : "Ingepland"} door ${firstName(viewer.fullName)}.`,
        href: `/editor-meetings/${id}`,
        entityType: "editor_meeting",
        entityId: id,
        dedupeKey: `editormeeting:gepland-owner:${id}:${at.toISOString()}`,
      });
    }
  }
  await syncPlanTasks(todayAmsterdam(now), now);
  return { id };
}

/** Bespreekpunten bijwerken (zichtbaar voor de editor). */
export async function saveTopics(viewer: Viewer, meetingId: string, topics: string[]): Promise<void> {
  const m = await requireManageable(viewer, meetingId);
  await db.update(editorMeetings).set({ topics: cleanTopics(topics), updatedAt: new Date() }).where(eq(editorMeetings.id, m.id));
}

/** Meeting annuleren: de maand staat daarna weer op "opnieuw plannen". */
export async function cancelMeeting(viewer: Viewer, meetingId: string, now = new Date()): Promise<void> {
  const m = await requireManageable(viewer, meetingId);
  if (m.reportStatus === "gepubliceerd") throw new ForbiddenError("Deze meeting is afgerond.");
  await db.update(editorMeetings).set({ status: "geannuleerd", updatedAt: new Date() }).where(eq(editorMeetings.id, m.id));
  if (m.scheduledAt) await clearByDedupe(`editormeeting:gepland:${m.id}:${new Date(m.scheduledAt).toISOString()}`);
  if (m.status === "gepland" && m.scheduledAt && new Date(m.scheduledAt).getTime() > now.getTime()) {
    await notify({
      userIds: [m.editorId],
      type: "editor_meeting.cancelled",
      level: "info",
      title: `Je editor meeting van ${meetingMomentShort(m.scheduledAt)} gaat niet door`,
      body: "Er wordt een nieuw moment gepland. Je krijgt bericht zodra dat vaststaat.",
      href: "/editor-meetings",
      entityType: "editor_meeting",
      entityId: m.id,
      dedupeKey: `editormeeting:geannuleerd:${m.id}`,
    });
  }
  await syncPlanTasks(todayAmsterdam(now), now);
}

async function requireManageable(viewer: Viewer, meetingId: string): Promise<MeetingRow> {
  if (!canUseTeamView(viewer)) throw new ForbiddenError("Dit onderdeel is alleen voor Team Shortclips.");
  const [m] = await db.select().from(editorMeetings).where(eq(editorMeetings.id, meetingId)).limit(1);
  if (!m) throw new ForbiddenError("Meeting niet gevonden.");
  const info = (await getOwnerMap([m.editorId])).get(m.editorId)!;
  if (!mayManage(viewer, info.ownerId, m.ownerId)) throw new ForbiddenError("Deze editor valt niet onder jouw verantwoordelijkheid.");
  return m;
}

/* --------------------------------- verslag --------------------------------- */

export type ReportInput = {
  insights: string;
  focusNext: string;
  internalNotes: string;
  points: { id?: string | null; kind: PointKind; theme: string; body: string; example?: string | null }[];
  actions: { id?: string | null; body: string; ownerType: OwnerType; assigneeId?: string | null; dueOn?: string | null }[];
  next?: { date: string; time: string; topics: string[] } | null;
  /** Wat er met de eigen bespreekpunten van de editor is gebeurd. */
  items?: { id: string; outcome: ItemOutcome | null }[];
};

function cleanDate(v: string | null | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Verslag opslaan als concept of publiceren.
 *
 * Concept: alleen zichtbaar voor de content creator en het management.
 * Publiceren: het verslag verschijnt in het editorportaal, de editor krijgt een
 * melding en elk actiepunt wordt een taak op de takenpagina van de
 * verantwoordelijke. De status van een actiepunt is de status van die taak.
 */
export async function saveReport(viewer: Viewer, meetingId: string, input: ReportInput, publish: boolean, now = new Date()): Promise<{ published: boolean; nextId: string | null }> {
  const m = await requireManageable(viewer, meetingId);
  if (m.status !== "gepland" || !m.scheduledAt) throw new ForbiddenError("Plan de meeting eerst in voordat je het verslag maakt.");
  const editor = await personById(m.editorId);
  if (!editor) throw new ForbiddenError("Editor niet gevonden.");
  const ownerId = m.ownerId ?? viewer.id;
  const wasPublished = m.reportStatus === "gepubliceerd";
  const willBePublished = wasPublished || publish;

  const report: EditorMeetingReport = { insights: input.insights.trim().slice(0, 4000), focusNext: input.focusNext.trim().slice(0, 4000) };
  await db
    .update(editorMeetings)
    .set({
      report,
      internalNotes: input.internalNotes.trim().slice(0, 6000) || null,
      reportStatus: willBePublished ? "gepubliceerd" : "concept",
      publishedAt: willBePublished ? m.publishedAt ?? now : null,
      publishedById: willBePublished ? m.publishedById ?? viewer.id : null,
      updatedAt: new Date(),
    })
    .where(eq(editorMeetings.id, m.id));

  /* Punten: bijwerken, toevoegen en wat is weggehaald verwijderen. */
  const points = input.points
    .filter((p) => (POINT_KINDS as readonly string[]).includes(p.kind) && p.body.trim())
    .slice(0, 60);
  const existingPoints = await db.select({ id: editorMeetingPoints.id }).from(editorMeetingPoints).where(eq(editorMeetingPoints.meetingId, m.id));
  const knownPoints = new Set(existingPoints.map((p) => p.id));
  const keptPoints = new Set<string>();
  for (const [i, p] of points.entries()) {
    const data = { kind: p.kind, theme: cleanTheme(p.kind, p.theme), body: p.body.trim().slice(0, 2000), example: p.example?.trim().slice(0, 2000) || null, sortOrder: i, updatedAt: new Date() };
    if (p.id && knownPoints.has(p.id)) {
      await db.update(editorMeetingPoints).set(data).where(eq(editorMeetingPoints.id, p.id));
      keptPoints.add(p.id);
    } else {
      await db.insert(editorMeetingPoints).values({ meetingId: m.id, editorId: m.editorId, ...data });
    }
  }
  const dropPoints = [...knownPoints].filter((id) => !keptPoints.has(id));
  if (dropPoints.length) await db.delete(editorMeetingPoints).where(inArray(editorMeetingPoints.id, dropPoints));

  /* Actiepunten. */
  const staff = await db.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.status, "active"), isNull(users.deletedAt)));
  const staffIds = new Set(staff.filter((u) => isCoreStaff(u.email)).map((u) => u.id));
  const actions = input.actions.filter((a) => a.body.trim()).slice(0, 40);
  const existingActions = await db.select().from(editorMeetingActions).where(eq(editorMeetingActions.meetingId, m.id));
  const knownActions = new Map(existingActions.map((a) => [a.id, a]));
  const keptActions = new Set<string>();
  for (const [i, a] of actions.entries()) {
    const ownerType: OwnerType = (OWNER_TYPES as readonly string[]).includes(a.ownerType) ? a.ownerType : "editor";
    const assigneeId = ownerType === "editor" ? m.editorId : ownerType === "shortclips" && a.assigneeId && staffIds.has(a.assigneeId) ? a.assigneeId : ownerId;
    const data = { body: a.body.trim().slice(0, 1000), ownerType, assigneeId, dueOn: cleanDate(a.dueOn), sortOrder: i, updatedAt: new Date() };
    if (a.id && knownActions.has(a.id)) {
      await db.update(editorMeetingActions).set(data).where(eq(editorMeetingActions.id, a.id));
      keptActions.add(a.id);
    } else {
      await db.insert(editorMeetingActions).values({ meetingId: m.id, editorId: m.editorId, ...data });
    }
  }
  for (const [id, old] of knownActions) {
    if (keptActions.has(id)) continue;
    // Weggehaald actiepunt: de taak vervalt, zodat hij nergens blijft hangen.
    if (old.taskId) await db.update(tasks).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(tasks.id, old.taskId), inArray(tasks.status, [...OPEN_TASK])));
    await db.delete(editorMeetingActions).where(eq(editorMeetingActions.id, id));
  }

  await applyItemOutcomes(viewer, m, input.items ?? [], now);

  if (willBePublished) {
    await ensureActionTasks(viewer, m, editor);
    if (!wasPublished) {
      await clearByDedupe(`editormeeting:verslag-ontbreekt:${m.id}`);
      await notify({
        userIds: [m.editorId],
        type: "editor_meeting.report",
        level: "success",
        title: `Het verslag van je editor meeting van ${monthLabel(m.period)} staat klaar`,
        body: "Je vindt de inzichten, verbeterpunten en actiepunten op je pagina Editor Meetings.",
        href: `/editor-meetings/${m.id}`,
        entityType: "editor_meeting",
        entityId: m.id,
        dedupeKey: `editormeeting:verslag:${m.id}`,
      });
    }
  }

  /* Volgende meeting alvast vastleggen. */
  let nextId: string | null = null;
  if (input.next?.date && input.next.time) {
    const res = await planMeeting(viewer, { editorId: m.editorId, date: input.next.date, time: input.next.time, topics: input.next.topics, location: m.location, meetingUrl: m.meetingUrl, durationMinutes: m.durationMinutes }, now);
    nextId = res.id;
  }
  return { published: willBePublished, nextId };
}

/** Elk actiepunt van een gepubliceerd verslag heeft precies één taak. */
async function ensureActionTasks(viewer: Viewer, m: MeetingRow, editor: Person): Promise<void> {
  const actions = await db.select().from(editorMeetingActions).where(eq(editorMeetingActions.meetingId, m.id));
  for (const a of actions) {
    const title = (a.ownerType === "editor" ? `Editor meeting | ${a.body}` : `Editor meeting ${firstName(editor.fullName)} | ${a.body}`).slice(0, 240);
    if (a.taskId) {
      await db
        .update(tasks)
        .set({ title, assigneeId: a.assigneeId, dueOn: a.dueOn, updatedAt: new Date() })
        .where(and(eq(tasks.id, a.taskId), inArray(tasks.status, [...OPEN_TASK])));
      continue;
    }
    const key = `${ACTION_TASK_PREFIX}${a.id}`;
    const [task] = await db
      .insert(tasks)
      .values({
        title,
        description: `Actiepunt uit de editor meeting van ${monthLabel(m.period)} met ${editor.fullName}.`,
        status: "todo",
        priority: "normal",
        category: "werkzaamheden",
        assigneeId: a.assigneeId,
        dueOn: a.dueOn,
        entityType: "editor_meeting",
        entityId: m.id,
        source: "manual",
        dedupeKey: key,
        createdById: viewer.id,
      })
      .onConflictDoNothing()
      .returning({ id: tasks.id });
    const taskId = task?.id ?? (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.dedupeKey, key)).orderBy(desc(tasks.createdAt)).limit(1))[0]?.id;
    if (!taskId) continue;
    await db.update(editorMeetingActions).set({ taskId, updatedAt: new Date() }).where(eq(editorMeetingActions.id, a.id));
    // De editor krijgt één melding voor het hele verslag; een collega krijgt de taak gemeld.
    if (task && a.assigneeId && a.assigneeId !== viewer.id && a.assigneeId !== m.editorId) {
      await notify({
        userIds: [a.assigneeId],
        type: "task_assigned",
        level: "info",
        title: `Actiepunt uit de editor meeting met ${firstName(editor.fullName)}`,
        body: a.body.slice(0, 200),
        href: `/tasks?persoon=${a.assigneeId}`,
        entityType: "task",
        entityId: taskId,
        dedupeKey: `task_assigned:${taskId}:${a.assigneeId}`,
      });
    }
  }
}

/** Verbeterpunt of vaardigheid markeren als behaald (of weer openzetten). */
export async function setPointStatus(viewer: Viewer, pointId: string, status: "open" | "behaald"): Promise<void> {
  const [p] = await db.select({ id: editorMeetingPoints.id, meetingId: editorMeetingPoints.meetingId, kind: editorMeetingPoints.kind }).from(editorMeetingPoints).where(eq(editorMeetingPoints.id, pointId)).limit(1);
  if (!p) throw new ForbiddenError("Punt niet gevonden.");
  await requireManageable(viewer, p.meetingId);
  if (p.kind !== "verbeterpunt" && p.kind !== "vaardigheid") throw new ForbiddenError("Alleen verbeterpunten kunnen worden afgerond.");
  await db.update(editorMeetingPoints).set({ status, resolvedAt: status === "behaald" ? new Date() : null, updatedAt: new Date() }).where(eq(editorMeetingPoints.id, pointId));
}

/**
 * Actiepunt afvinken of weer openzetten. Dit wijzigt de gekoppelde taak, dus
 * de takenpagina, het editorportaal en het verslag laten direct hetzelfde zien.
 * Mag: degene aan wie het actiepunt is toegewezen, de verantwoordelijke content
 * creator en het management.
 */
export async function setActionDone(viewer: Viewer, actionId: string, done: boolean): Promise<void> {
  if (!canUseEditorMeetings(viewer)) throw new ForbiddenError();
  const [a] = await db
    .select({ id: editorMeetingActions.id, meetingId: editorMeetingActions.meetingId, editorId: editorMeetingActions.editorId, assigneeId: editorMeetingActions.assigneeId, taskId: editorMeetingActions.taskId, reportStatus: editorMeetings.reportStatus, ownerId: editorMeetings.ownerId })
    .from(editorMeetingActions)
    .innerJoin(editorMeetings, eq(editorMeetings.id, editorMeetingActions.meetingId))
    .where(eq(editorMeetingActions.id, actionId))
    .limit(1);
  if (!a || a.reportStatus !== "gepubliceerd" || !a.taskId) throw new ForbiddenError("Actiepunt niet gevonden.");
  if (a.assigneeId !== viewer.id) {
    if (isEditorRole(viewer)) throw new ForbiddenError("Dit actiepunt is niet van jou.");
    const info = (await getOwnerMap([a.editorId])).get(a.editorId)!;
    if (!mayManage(viewer, info.ownerId, a.ownerId)) throw new ForbiddenError("Dit actiepunt is niet van jou.");
  }
  await db
    .update(tasks)
    .set({ status: done ? "done" : "todo", completedAt: done ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(tasks.id, a.taskId), isNull(tasks.deletedAt), ne(tasks.status, "cancelled")));
}

/* ------------------------- eigen bespreekpunten editor ------------------------- */

export type ItemView = {
  id: string;
  editorId: string;
  body: string;
  status: string;
  outcome: ItemOutcome | null;
  meetingId: string | null;
  /** Maand van de meeting waarin het punt is behandeld. */
  period: string | null;
  createdAt: Date;
  /** Hoe de editor het punt ziet (een conceptverslag blijft intern). */
  editorState: "open" | "in_verslag" | "behandeld";
};

async function loadItems(where: ReturnType<typeof and>): Promise<ItemView[]> {
  const list = await db
    .select({
      id: editorMeetingItems.id,
      editorId: editorMeetingItems.editorId,
      body: editorMeetingItems.body,
      status: editorMeetingItems.status,
      outcome: editorMeetingItems.outcome,
      meetingId: editorMeetingItems.meetingId,
      createdAt: editorMeetingItems.createdAt,
      period: editorMeetings.period,
      reportStatus: editorMeetings.reportStatus,
    })
    .from(editorMeetingItems)
    .leftJoin(editorMeetings, eq(editorMeetings.id, editorMeetingItems.meetingId))
    .where(where)
    .orderBy(asc(editorMeetingItems.createdAt));
  return list.map((r) => ({
    id: r.id,
    editorId: r.editorId,
    body: r.body,
    status: r.status,
    outcome: isItemOutcome(r.outcome) ? r.outcome : null,
    meetingId: r.meetingId,
    period: r.period ?? null,
    createdAt: new Date(r.createdAt),
    editorState: itemStateForEditor(r.status, r.reportStatus ?? null),
  }));
}

/**
 * Voor welke meeting zijn nieuwe bespreekpunten bedoeld? De eerstvolgende
 * geplande meeting; staat er niets gepland, dan de meeting van deze maand, of
 * van volgende maand als die van deze maand al is geweest.
 */
function nextTarget(meetings: MeetingRow[], now: Date): { period: string; meetingId: string | null; ownerId: string | null } {
  const current = periodOf(todayAmsterdam(now));
  const upcoming = meetings
    .filter((m) => m.status === "gepland" && m.scheduledAt && new Date(m.scheduledAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())[0];
  if (upcoming) return { period: upcoming.period, meetingId: upcoming.id, ownerId: upcoming.ownerId };
  const cur = meetings.find((m) => m.period === current);
  const curDone = !!cur && (cur.reportStatus === "gepubliceerd" || (cur.status === "gepland" && !!cur.scheduledAt && new Date(cur.scheduledAt).getTime() <= now.getTime()));
  const period = curDone ? nextPeriod(current) : current;
  const m = meetings.find((x) => x.period === period) ?? null;
  return { period, meetingId: m?.id ?? null, ownerId: m?.ownerId ?? null };
}

function cleanItem(body: string): string {
  const text = body.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_LENGTH);
  if (!text) throw new ForbiddenError("Vul een bespreekpunt in.");
  return text;
}

async function requireOwnOpenItem(viewer: Viewer, itemId: string) {
  if (!isEditorRole(viewer)) throw new ForbiddenError("Alleen de editor zelf kan dit bespreekpunt aanpassen.");
  const [item] = await db.select().from(editorMeetingItems).where(eq(editorMeetingItems.id, itemId)).limit(1);
  if (!item || item.editorId !== viewer.id) throw new ForbiddenError("Bespreekpunt niet gevonden.");
  if (item.status !== "open") throw new ForbiddenError("Dit punt is al besproken en kan niet meer worden aangepast.");
  return item;
}

/**
 * Eén melding per meeting aan de verantwoordelijke content creator zodra de
 * editor iets klaarzet. Meer punten voor dezelfde meeting geven geen nieuwe
 * melding (vaste sleutel per editor per maand).
 */
async function notifyOwnerOfItems(viewer: Viewer, now: Date): Promise<void> {
  const meetings = await db.select().from(editorMeetings).where(eq(editorMeetings.editorId, viewer.id));
  const target = nextTarget(meetings, now);
  const ownerId = target.ownerId ?? (await getOwnerMap([viewer.id])).get(viewer.id)?.ownerId ?? null;
  if (!ownerId) return;
  await notify({
    userIds: [ownerId],
    type: "editor_meeting.items",
    level: "info",
    title: `${firstName(viewer.fullName)} heeft bespreekpunten klaargezet`,
    body: `Voor de editor meeting van ${monthLabel(target.period)}. Je ziet ze op de meetingpagina en in het verslag.`,
    href: target.meetingId ? `/editor-meetings/${target.meetingId}` : "/editor-meetings",
    entityType: "editor_meeting",
    ...(target.meetingId ? { entityId: target.meetingId } : {}),
    dedupeKey: `editormeeting:inbreng:${viewer.id}:${target.period}`,
  });
}

/** Editor zet een eigen bespreekpunt klaar voor de eerstvolgende meeting. */
export async function addItem(viewer: Viewer, body: string, now = new Date()): Promise<{ id: string }> {
  if (!isEditorRole(viewer)) throw new ForbiddenError("Alleen editors zetten hier eigen bespreekpunten klaar.");
  const text = cleanItem(body);
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(editorMeetingItems)
    .where(and(eq(editorMeetingItems.editorId, viewer.id), eq(editorMeetingItems.status, "open")));
  if (Number(n) >= MAX_OPEN_ITEMS) throw new ForbiddenError(`Je hebt al ${MAX_OPEN_ITEMS} open bespreekpunten. Rond eerst een paar punten af in je meeting.`);
  const [row] = await db.insert(editorMeetingItems).values({ editorId: viewer.id, body: text, createdAt: now, updatedAt: now }).returning({ id: editorMeetingItems.id });
  await notifyOwnerOfItems(viewer, now);
  return { id: row!.id };
}

export async function updateItem(viewer: Viewer, itemId: string, body: string): Promise<void> {
  await requireOwnOpenItem(viewer, itemId);
  await db.update(editorMeetingItems).set({ body: cleanItem(body), updatedAt: new Date() }).where(eq(editorMeetingItems.id, itemId));
}

export async function deleteItem(viewer: Viewer, itemId: string): Promise<void> {
  await requireOwnOpenItem(viewer, itemId);
  await db.delete(editorMeetingItems).where(eq(editorMeetingItems.id, itemId));
}

/**
 * Legt bij het verslag vast wat er met de bespreekpunten van de editor is
 * gebeurd. Een behandeld punt wordt aan deze meeting gekoppeld en blijft daar
 * bewaard. Een punt dat in een andere meeting is behandeld, blijft ongemoeid.
 * Uitkomst weghalen zet het punt weer open voor de volgende meeting.
 */
async function applyItemOutcomes(viewer: Viewer, m: MeetingRow, list: { id: string; outcome: ItemOutcome | null }[], now: Date): Promise<void> {
  if (list.length === 0) return;
  const ids = [...new Set(list.map((i) => i.id))].slice(0, 60);
  const existing = await db.select().from(editorMeetingItems).where(and(inArray(editorMeetingItems.id, ids), eq(editorMeetingItems.editorId, m.editorId)));
  for (const it of list) {
    const row = existing.find((r) => r.id === it.id);
    if (!row) continue;
    if (row.status === "behandeld" && row.meetingId && row.meetingId !== m.id) continue;
    const outcome = isItemOutcome(it.outcome) ? it.outcome : null;
    if (outcome) {
      if (row.status === "behandeld" && row.meetingId === m.id && row.outcome === outcome) continue;
      await db
        .update(editorMeetingItems)
        .set({ status: "behandeld", outcome, meetingId: m.id, handledAt: now, handledById: viewer.id, updatedAt: new Date() })
        .where(eq(editorMeetingItems.id, row.id));
    } else if (row.meetingId === m.id) {
      await db
        .update(editorMeetingItems)
        .set({ status: "open", outcome: null, meetingId: null, handledAt: null, handledById: null, updatedAt: new Date() })
        .where(eq(editorMeetingItems.id, row.id));
    }
  }
}

/* ----------------------- maandelijkse plantaak en meldingen ----------------------- */

const STAGES = ["start", "laatste-dagen", "maand-gestart", "eerste-week-voorbij"] as const;

export type PlanSyncResult = { created: number; updated: number; completed: number; reopened: number; expired: number; reminders: number; reportReminders: number };

/**
 * Houdt per content creator één plantaak per maand bij.
 *
 *  - Zeven dagen voor het einde van de maand ontstaat de taak "Plan de editor
 *    meetings voor <volgende maand>", met wie al is ingepland, wie ontbreekt en
 *    wie opnieuw gepland moet worden.
 *  - De taak werkt zichzelf bij en rondt zichzelf af zodra alles is ingepland.
 *  - Ontbreken er nog meetings, dan blijft de taak staan en volgt op vaste
 *    momenten een herinnering.
 *  - Opnieuw uitvoeren levert nooit een tweede taak of een dubbele melding op:
 *    de taak heeft een vaste sleutel per maand en per persoon, de melding een
 *    sleutel per herinneringsmoment.
 */
export async function syncPlanTasks(today = todayAmsterdam(), now = new Date()): Promise<PlanSyncResult> {
  const out: PlanSyncResult = { created: 0, updated: 0, completed: 0, reopened: 0, expired: 0, reminders: 0, reportReminders: 0 };
  const { create, maintain } = planningPeriods(today);
  const current = periodOf(today);
  const [editors, owners] = await Promise.all([listActiveEditors(), listMeetingOwners()]);
  const ownerMap = await getOwnerMap(editors.map((e) => e.id), owners);
  const meetings = editors.length
    ? await db.select().from(editorMeetings).where(and(inArray(editorMeetings.editorId, editors.map((e) => e.id)), inArray(editorMeetings.period, maintain)))
    : [];

  // Plantaken van een voorbije maand vervallen: het overzicht toont die maand als "niet gehouden".
  const stale = await db.select({ id: tasks.id, dedupeKey: tasks.dedupeKey }).from(tasks).where(and(like(tasks.dedupeKey, `${PLAN_TASK_PREFIX}%`), inArray(tasks.status, [...OPEN_TASK]), isNull(tasks.deletedAt)));
  for (const t of stale) {
    const parsed = parsePlanTaskKey(t.dedupeKey);
    if (!parsed || parsed.period >= current) continue;
    await db.update(tasks).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, t.id));
    for (const s of STAGES) await clearByDedupe(`${t.dedupeKey}:${s}`);
    out.expired++;
  }

  for (const period of maintain) {
    for (const owner of owners) {
      const mine = editors.filter((e) => {
        const info = ownerMap.get(e.id)!;
        return info.ownerId === owner.id || info.ownerId === null;
      });
      const lines: PlanLine[] = mine.map((e) => {
        const unassigned = ownerMap.get(e.id)!.ownerId === null;
        const m = meetings.find((x) => x.editorId === e.id && x.period === period);
        const name = unassigned ? `${firstName(e.fullName)} (nog geen verantwoordelijke)` : firstName(e.fullName);
        if (!m) return { editorName: name, state: "ontbreekt" };
        if (m.reportStatus === "gepubliceerd" || (m.status === "gepland" && m.scheduledAt)) return { editorName: name, state: "gepland", when: m.scheduledAt ? meetingMomentShort(m.scheduledAt) : null };
        return { editorName: name, state: "opnieuw" };
      });
      const missing = lines.filter((l) => l.state !== "gepland");
      const key = planTaskKey(period, owner.id);
      const description = planTaskDescription(lines);
      const [existing] = await db
        .select({ id: tasks.id, status: tasks.status, description: tasks.description, deletedAt: tasks.deletedAt })
        .from(tasks)
        .where(eq(tasks.dedupeKey, key))
        .orderBy(desc(tasks.createdAt))
        .limit(1);

      let active = false;
      if (!existing) {
        // Een nieuwe taak ontstaat alleen voor de volgende maand, en alleen als er iets te plannen valt.
        if (period !== create || missing.length === 0) continue;
        const [task] = await db
          .insert(tasks)
          .values({
            title: planTaskTitle(period),
            description,
            status: "todo",
            priority: "normal",
            category: "werkzaamheden",
            assigneeId: owner.id,
            dueOn: lastDayOfPeriod(prevPeriod(period)),
            entityType: "editor_meeting_plan",
            source: "automation",
            dedupeKey: key,
          })
          .onConflictDoNothing()
          .returning({ id: tasks.id });
        if (!task) continue;
        out.created++;
        active = true;
      } else if (existing.deletedAt) {
        continue; // bewust verwijderd door het team: niet opnieuw aanmaken
      } else if (missing.length === 0) {
        if (existing.status !== "done") {
          await db.update(tasks).set({ status: "done", completedAt: new Date(), description, updatedAt: new Date() }).where(eq(tasks.id, existing.id));
          out.completed++;
        }
        for (const s of STAGES) await clearByDedupe(`${key}:${s}`);
        continue;
      } else {
        const closed = existing.status === "done" || existing.status === "cancelled";
        if (closed || existing.description !== description) {
          await db
            .update(tasks)
            .set({ description, ...(closed ? { status: "todo" as const, completedAt: null } : {}), updatedAt: new Date() })
            .where(eq(tasks.id, existing.id));
          if (closed) out.reopened++;
          else out.updated++;
        }
        active = true;
      }

      const stage = active ? reminderStage(today, period) : null;
      if (!stage) continue;
      const names = missing.map((l) => l.editorName).join(", ");
      const sent = await notify({
        userIds: [owner.id],
        type: "editor_meeting.plan",
        level: stage === "eerste-week-voorbij" ? "warning" : "info",
        title: stage === "start" ? `Plan de editor meetings voor ${monthLabel(period)}.` : `Herinnering: plan de editor meetings voor ${monthLabel(period)}.`,
        body: `Nog te plannen: ${names}. De taak staat op je takenpagina en verdwijnt zodra alles is ingepland.`,
        href: `/editor-meetings?maand=${period}`,
        entityType: "editor_meeting_plan",
        dedupeKey: `${key}:${stage}`,
      });
      out.reminders += sent;
    }
  }

  // Meeting geweest, verslag na drie dagen nog niet gepubliceerd: één herinnering.
  const cutoff = new Date(now.getTime() - REPORT_GRACE_DAYS * 86_400_000);
  for (const m of meetings) {
    if (m.status !== "gepland" || !m.scheduledAt || m.reportStatus === "gepubliceerd" || !m.ownerId) continue;
    if (new Date(m.scheduledAt).getTime() > cutoff.getTime()) continue;
    const editor = editors.find((e) => e.id === m.editorId);
    if (!editor) continue;
    out.reportReminders += await notify({
      userIds: [m.ownerId],
      type: "editor_meeting.report_missing",
      level: "warning",
      title: `Verslag editor meeting ${firstName(editor.fullName)} ontbreekt nog`,
      body: `De meeting van ${meetingMomentShort(m.scheduledAt)} is geweest. Publiceer het verslag, zodat ${firstName(editor.fullName)} de afspraken terugziet.`,
      href: `/editor-meetings/${m.id}`,
      entityType: "editor_meeting",
      entityId: m.id,
      dedupeKey: `editormeeting:verslag-ontbreekt:${m.id}`,
    });
  }
  return out;
}

/** Dagelijkse job editor_meetings.sync. */
export async function runEditorMeetingsSync() {
  return runJob("system", "editor_meetings.sync", {}, async (ctx) => {
    const r = await syncPlanTasks();
    ctx.counters.created = r.created;
    ctx.counters.updated = r.updated + r.completed + r.reopened + r.expired;
    ctx.counters.processed = r.created + r.updated + r.completed + r.reopened + r.expired + r.reminders + r.reportReminders;
    ctx.log(`Editor meetings: ${r.created} plantaken aangemaakt, ${r.updated} bijgewerkt, ${r.completed} afgerond, ${r.reopened} heropend, ${r.expired} vervallen, ${r.reminders} herinneringen, ${r.reportReminders} verslagherinneringen.`);
  });
}

let lastRun = 0;
/** Vangnet bij het laden van de pagina's: hooguit eens per half uur per server-instantie. */
export async function syncPlanTasksIfStale(maxAgeMinutes = 30): Promise<void> {
  if (Date.now() - lastRun < maxAgeMinutes * 60_000) return;
  lastRun = Date.now();
  try {
    await syncPlanTasks();
  } catch (error) {
    console.error("[editor-meetings] synchroniseren mislukt", error);
  }
}
