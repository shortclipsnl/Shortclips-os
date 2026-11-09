import "server-only";
import { and, eq, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientFeedbackRounds, clients, deliverables, tasks, users } from "@/db/schema";
import { nlHolidaySet } from "@/lib/holidays";
import { amsterdamDay, clientFeedbackDue } from "@/lib/client-feedback";
import { feedbackTermLabel, feedbackTermState, planRound, reminderDue, type FeedbackTermState } from "@/lib/feedback-term";
import { isInactiveClientStatus } from "@/lib/client-status";
import { getPortalSettingsForClient } from "@/server/portal-settings";
import { isCoreStaff } from "@/server/core-staff";
import { clearByDedupe, notify } from "@/server/notifications";
import { runJob } from "@/server/jobs/runner";

/**
 * Feedbacktermijn klant op de Editing-pagina.
 *
 * Elke keer dat een video op "Feedback klant" (client_review) komt, start een
 * feedbackronde met een termijn in werkdagen. Op de laatste termijndag (standaard
 * werkdag 3) krijgt alléén de vaste verantwoordelijke van de klant om 09:00 een
 * melding plus een taak "Feedbackherinnering sturen: [klant]". Verlaat de video de
 * fase, dan stopt de ronde en vervalt een openstaande taak automatisch.
 *
 * Alles is afgeleid van de opgeslagen status, dus het rekent na een herstart of
 * gemiste run gewoon goed door. Aangeroepen na een statuswissel, bij het openen
 * van Editing (vangnet) en elk uur op werkdagen via de job feedback.reminders.
 * Idempotent: vaker draaien geeft nooit dubbele rondes, taken of meldingen.
 */

export const FEEDBACK_TASK_PREFIX = "feedbackronde:";
const dedupeFor = (roundId: string) => `${FEEDBACK_TASK_PREFIX}${roundId}`;
/** Sleutelprefix van de oude regel "Klant reageert te lang niet → opvolgtaak". */
const LEGACY_TASK_PREFIX = "client_silent_for_5_days:";
/** Een gemiste herinnering (storing) halen we hooguit één werkdag later nog in. */
const MAX_LATE_FOR_REMINDER = 1;

const OPEN_TASK = ["todo", "in_progress", "blocked"] as const;

function todayAmsterdam(): string {
  return amsterdamDay(new Date());
}

export type FeedbackSyncResult = { opened: number; closed: number; tasksClosed: number };

/**
 * Rondes gelijktrekken met de huidige videostatus. Zonder `ids`: alle video's
 * op Feedback klant plus alle video's met een lopende ronde.
 */
export async function syncFeedbackRounds(ids?: string[]): Promise<FeedbackSyncResult> {
  const result: FeedbackSyncResult = { opened: 0, closed: 0, tasksClosed: 0 };

  let scope: string[];
  if (ids) {
    scope = [...new Set(ids.filter(Boolean))];
  } else {
    const [atClient, open] = await Promise.all([
      db.select({ id: deliverables.id }).from(deliverables)
        .where(and(isNull(deliverables.deletedAt), eq(deliverables.status, "client_review"))),
      db.select({ id: clientFeedbackRounds.deliverableId }).from(clientFeedbackRounds)
        .where(isNull(clientFeedbackRounds.endedAt)),
    ]);
    scope = [...new Set([...atClient.map((r) => r.id), ...open.map((r) => r.id)])];
  }
  if (scope.length === 0) return result;

  const [videos, rounds] = await Promise.all([
    db.select({
      id: deliverables.id,
      clientId: deliverables.clientId,
      status: deliverables.status,
      deletedAt: deliverables.deletedAt,
      statusChangedAt: deliverables.statusChangedAt,
      clientRevisionRounds: deliverables.clientRevisionRounds,
    }).from(deliverables).where(inArray(deliverables.id, scope)),
    db.select({
      id: clientFeedbackRounds.id,
      deliverableId: clientFeedbackRounds.deliverableId,
      roundNumber: clientFeedbackRounds.roundNumber,
      endedAt: clientFeedbackRounds.endedAt,
      revisionMark: clientFeedbackRounds.revisionMark,
      reminderTaskId: clientFeedbackRounds.reminderTaskId,
    }).from(clientFeedbackRounds).where(inArray(clientFeedbackRounds.deliverableId, scope)),
  ]);
  const videoById = new Map(videos.map((v) => [v.id, v]));
  const holidays = nlHolidaySet();
  const termCache = new Map<string, number>();
  const termFor = async (clientId: string) => {
    let t = termCache.get(clientId);
    if (t === undefined) {
      try {
        t = (await getPortalSettingsForClient(clientId)).feedbackDaysVideos;
      } catch {
        t = 3;
      }
      if (!Number.isFinite(t) || t < 1) t = 3;
      termCache.set(clientId, t);
    }
    return t;
  };

  for (const id of scope) {
    const v = videoById.get(id) ?? null;
    const mine = rounds.filter((r) => r.deliverableId === id);
    const open = mine.find((r) => r.endedAt == null) ?? null;
    const plan = planRound(
      v ? { status: v.status, deleted: v.deletedAt != null, statusChangedAt: v.statusChangedAt, clientRevisionRounds: v.clientRevisionRounds } : null,
      open ? { id: open.id, revisionMark: open.revisionMark } : null,
    );

    if (plan.close && open) {
      const closed = await db.update(clientFeedbackRounds)
        .set({ endedAt: new Date(), endedStatus: v?.deletedAt ? "verwijderd" : (v?.status ?? "verwijderd"), updatedAt: new Date() })
        .where(and(eq(clientFeedbackRounds.id, open.id), isNull(clientFeedbackRounds.endedAt)))
        .returning({ id: clientFeedbackRounds.id });
      if (closed.length) {
        result.closed++;
        result.tasksClosed += await expireReminder(open.id, open.reminderTaskId);
      }
    }

    if (plan.open && v) {
      const termDays = await termFor(v.clientId);
      const startedAt = v.statusChangedAt instanceof Date ? v.statusChangedAt : new Date(v.statusChangedAt as unknown as string);
      const roundNumber = Math.max(0, ...mine.map((r) => r.roundNumber)) + 1;
      const inserted = await db.insert(clientFeedbackRounds).values({
        deliverableId: v.id,
        clientId: v.clientId,
        roundNumber,
        startedAt,
        startedOn: amsterdamDay(startedAt),
        termDays,
        dueOn: clientFeedbackDue(startedAt, termDays, holidays),
        revisionMark: v.clientRevisionRounds,
      }).onConflictDoNothing().returning({ id: clientFeedbackRounds.id });
      result.opened += inserted.length;
    }
  }
  return result;
}

/** Openstaande herinneringstaak laten vervallen en de melding opruimen. */
async function expireReminder(roundId: string, taskId: string | null): Promise<number> {
  const cond = taskId
    ? eq(tasks.id, taskId)
    : eq(tasks.dedupeKey, dedupeFor(roundId));
  const res = await db.update(tasks)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(and(cond, inArray(tasks.status, [...OPEN_TASK]), like(tasks.dedupeKey, `${FEEDBACK_TASK_PREFIX}%`)))
    .returning({ id: tasks.id });
  await clearByDedupe(dedupeFor(roundId));
  return res.length;
}

function ordinal(n: number): string {
  return ["eerste", "tweede", "derde", "vierde", "vijfde", "zesde", "zevende", "achtste", "negende", "tiende"][n - 1] ?? `${n}e`;
}

export type FeedbackReminderResult = { reminded: number; covered: number; skippedNoOwner: number };

/**
 * Herinneringen aanmaken voor rondes die op hun laatste termijndag staan.
 * Alleen op werkdagen vanaf 09:00; per ronde precies één melding en één taak.
 */
export async function createDueFeedbackReminders(now = new Date()): Promise<FeedbackReminderResult> {
  const out: FeedbackReminderResult = { reminded: 0, covered: 0, skippedNoOwner: 0 };
  const today = amsterdamDay(now);
  const holidays = nlHolidaySet();

  const rows = await db
    .select({
      id: clientFeedbackRounds.id,
      deliverableId: clientFeedbackRounds.deliverableId,
      clientId: clientFeedbackRounds.clientId,
      startedAt: clientFeedbackRounds.startedAt,
      termDays: clientFeedbackRounds.termDays,
      roundNumber: clientFeedbackRounds.roundNumber,
      title: deliverables.title,
      clientName: clients.name,
      clientStatus: clients.status,
      coordinatorId: clients.coordinatorId,
      coordRole: users.primaryRole,
      coordEmail: users.email,
      coordStatus: users.status,
      coordDeleted: users.deletedAt,
    })
    .from(clientFeedbackRounds)
    .innerJoin(deliverables, eq(deliverables.id, clientFeedbackRounds.deliverableId))
    .innerJoin(clients, eq(clients.id, clientFeedbackRounds.clientId))
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(
      isNull(clientFeedbackRounds.endedAt),
      isNull(clientFeedbackRounds.reminderAt),
      isNull(deliverables.deletedAt),
      eq(deliverables.status, "client_review"),
    ));

  for (const r of rows) {
    const state = feedbackTermState(r.startedAt, r.termDays, today, holidays);
    if (!reminderDue({ state, now, today, alreadyReminded: false, holidays })) continue;
    if (state.lateBy > MAX_LATE_FOR_REMINDER) continue;
    if (isInactiveClientStatus(r.clientStatus)) continue;

    // Bestaat er voor deze ronde al een opvolgtaak van de oude regel, dan geen
    // tweede taak: die telt als de herinnering voor deze ronde.
    const [legacy] = await db.select({ id: tasks.id }).from(tasks).where(and(
      like(tasks.dedupeKey, `${LEGACY_TASK_PREFIX}${r.deliverableId}:%`),
      isNull(tasks.deletedAt),
      gte(tasks.createdAt, r.startedAt),
    )).limit(1);
    if (legacy) {
      await db.update(clientFeedbackRounds)
        .set({ reminderAt: new Date(), reminderTaskId: legacy.id, updatedAt: new Date() })
        .where(and(eq(clientFeedbackRounds.id, r.id), isNull(clientFeedbackRounds.reminderAt)));
      out.covered++;
      continue;
    }

    // Alleen de vaste verantwoordelijke van de klant; nooit een editor.
    const validOwner = r.coordinatorId && !r.coordDeleted && r.coordStatus === "active"
      && (r.coordRole !== "editor" || isCoreStaff(r.coordEmail));
    if (!validOwner) {
      out.skippedNoOwner++;
      continue;
    }
    const ownerId = r.coordinatorId!;

    // Eerst de ronde claimen, zodat gelijktijdige runs nooit dubbel aanmaken.
    const claimed = await db.update(clientFeedbackRounds)
      .set({ reminderAt: new Date(), reminderUserId: ownerId, updatedAt: new Date() })
      .where(and(eq(clientFeedbackRounds.id, r.id), isNull(clientFeedbackRounds.reminderAt)))
      .returning({ id: clientFeedbackRounds.id });
    if (!claimed.length) continue;

    const dagTekst = state.lateBy > 0
      ? `De feedbacktermijn van ${state.termDays} werkdagen is verstreken.`
      : `De klant zit op de ${ordinal(state.termDays)} werkdag van de feedbacktermijn.`;
    const body = `${dagTekst} Er is nog geen feedback ontvangen op "${r.title}"${r.roundNumber > 1 ? ` (feedbackronde ${r.roundNumber})` : ""}.\n\nActie: stuur de klant vandaag een vriendelijke herinnering om de feedback aan te leveren.`;

    const [task] = await db.insert(tasks).values({
      clientId: r.clientId,
      title: `Feedbackherinnering sturen: ${r.clientName}`,
      description: `${body}\n\nVink deze taak af zodra de herinnering verstuurd is. Geeft de klant eerder feedback, dan vervalt de taak vanzelf.`,
      priority: "high",
      status: "todo",
      entityType: "deliverable",
      entityId: r.deliverableId,
      assigneeId: ownerId,
      dueOn: today,
      source: "automation",
      dedupeKey: dedupeFor(r.id),
    }).onConflictDoNothing().returning({ id: tasks.id });

    if (task) {
      await db.update(clientFeedbackRounds).set({ reminderTaskId: task.id }).where(eq(clientFeedbackRounds.id, r.id));
    }
    await notify({
      userIds: [ownerId],
      clientId: r.clientId,
      type: "feedback.reminder",
      level: "warning",
      title: `Feedbackherinnering: ${r.clientName}`,
      body,
      href: `/videos/${r.deliverableId}`,
      entityType: "deliverable",
      entityId: r.deliverableId,
      dedupeKey: dedupeFor(r.id),
    });
    out.reminded++;
  }
  return out;
}

/** Job feedback.reminders: rondes bijwerken (vangnet) en herinneringen maken. */
export async function runFeedbackReminders() {
  return runJob("system", "feedback.reminders", {}, async (ctx) => {
    const sync = await syncFeedbackRounds();
    ctx.counters.processed += sync.opened + sync.closed;
    ctx.log(`Rondes: ${sync.opened} gestart, ${sync.closed} gestopt, ${sync.tasksClosed} taken vervallen.`);
    const rem = await createDueFeedbackReminders();
    ctx.counters.created += rem.reminded;
    ctx.log(`Herinneringen: ${rem.reminded} aangemaakt, ${rem.covered} al gedekt door een opvolgtaak, ${rem.skippedNoOwner} zonder verantwoordelijke.`);
  });
}

export type FeedbackTermView = {
  title: string;
  sub: string;
  tone: "groen" | "oranje" | "rood" | "rood_vol";
  round: number;
  dueOn: string;
  state: FeedbackTermState;
  /** "open" = taak staat nog open, "verstuurd" = afgevinkt, null = (nog) geen herinnering. */
  reminder: "open" | "verstuurd" | null;
};

/** Lopende ronde per video, voor het label op de Editing-pagina. */
export async function getFeedbackTerms(deliverableIds: string[]): Promise<Map<string, FeedbackTermView>> {
  const map = new Map<string, FeedbackTermView>();
  const ids = [...new Set(deliverableIds.filter(Boolean))];
  if (!ids.length) return map;
  const rows = await db
    .select({
      deliverableId: clientFeedbackRounds.deliverableId,
      startedAt: clientFeedbackRounds.startedAt,
      termDays: clientFeedbackRounds.termDays,
      roundNumber: clientFeedbackRounds.roundNumber,
      reminderAt: clientFeedbackRounds.reminderAt,
      taskStatus: tasks.status,
    })
    .from(clientFeedbackRounds)
    .leftJoin(tasks, eq(tasks.id, clientFeedbackRounds.reminderTaskId))
    .where(and(isNull(clientFeedbackRounds.endedAt), inArray(clientFeedbackRounds.deliverableId, ids)));
  const today = todayAmsterdam();
  const holidays = nlHolidaySet();
  for (const r of rows) {
    const state = feedbackTermState(r.startedAt, r.termDays, today, holidays);
    const label = feedbackTermLabel(state);
    const reminder = !r.reminderAt ? null : r.taskStatus === "done" ? "verstuurd" : "open";
    map.set(r.deliverableId, { ...label, round: r.roundNumber, dueOn: state.dueOn, state, reminder });
  }
  return map;
}

/** Video's waarvan de lopende ronde al een herinnering kreeg (voor de oude opvolgregel). */
export async function remindedDeliverables(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ id: clientFeedbackRounds.deliverableId }).from(clientFeedbackRounds)
    .where(and(isNull(clientFeedbackRounds.endedAt), sql`${clientFeedbackRounds.reminderAt} is not null`, inArray(clientFeedbackRounds.deliverableId, ids)));
  return new Set(rows.map((r) => r.id));
}
