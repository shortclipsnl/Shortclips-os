import "server-only";
import { and, eq, gte, inArray, isNull, like, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, deliverables, notifications, productionDays, tasks, users } from "@/db/schema";
import { isActiveClientStatus, isInactiveClientStatus, INACTIVE_CLIENT_STATUSES } from "@/lib/client-status";
import { SCRIPTING_TASK_PREFIX } from "@/lib/scripting-task-plan";
import { MANUAL_NOTIFICATION_TYPES } from "@/server/client-activity";
import { notify } from "@/server/notifications";
import { syncScriptingTasks } from "@/server/scripting-tasks";

/**
 * Wat er gebeurt als een klant van status wisselt. Wordt aangeroepen vanuit elke
 * plek waar de status verandert (schakelaar in het klantenoverzicht, klantformulier)
 * en 's nachts als vangnet voor alle niet actieve klanten.
 *
 * Naar NIET ACTIEF:
 *  - open automatische taken worden geannuleerd (blijven terug te vinden), met
 *    een vrijgegeven dedupe-sleutel zodat ze bij heractivatie niet blokkeren;
 *  - scriptingtaken sluiten via de bestaande scripting-koppeling;
 *  - ongelezen automatische meldingen over de klant worden als gelezen gezet;
 *  - rapportages in de wachtrij worden niet meer gegenereerd;
 *  - lopend werk (handmatige taken, video's in productie, ingeplande opnames)
 *    verdwijnt NIET: de coördinator krijgt één beoordelingstaak met een overzicht,
 *    zodat bewust wordt besloten om af te ronden of te annuleren.
 *  - er wordt nooit klantdata verwijderd.
 *
 * Naar ACTIEF:
 *  - de beoordelingstaak vervalt;
 *  - scriptingtaken ontstaan opnieuw voor de aankomende opnames (actuele deadlines);
 *  - alle andere processen pakken de klant vanzelf weer op bij hun volgende run,
 *    met de actuele planning. Oude, tegengehouden meldingen bestaan niet en
 *    worden dus ook niet alsnog verstuurd; dedupe-sleutels voorkomen dubbels.
 */

const OPEN_TASK = ["todo", "in_progress", "blocked"] as const;
const DONE_VIDEO = ["approved", "ready_to_publish", "scheduled", "published", "analysis_available"] as const;
const REVIEW_PREFIX = "klantstatus_review:";

export type TransitionResult = {
  direction: "deactivated" | "reactivated" | "none";
  cancelledTasks: number;
  scriptingClosed: number;
  scriptingCreated: number;
  mutedNotifications: number;
  stoppedReports: number;
  reviewTaskId: string | null;
};

function todayAmsterdam(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

/** Annuleert open automatische taken (niet de scripting-koppeling, die regelt dat zelf). */
async function cancelAutomaticTasks(clientId: string): Promise<{ count: number; titles: string[] }> {
  const rows = await db
    .update(tasks)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      // Sleutel vrijgeven: de partiële unieke index telt ook geannuleerde taken mee.
      dedupeKey: sql`case when ${tasks.dedupeKey} is null then null else left(${tasks.dedupeKey}, 140) || ':niet-actief:' || ${tasks.id}::text end`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(tasks.clientId, clientId),
      eq(tasks.source, "automation"),
      isNull(tasks.deletedAt),
      inArray(tasks.status, [...OPEN_TASK]),
      sql`coalesce(${tasks.dedupeKey}, '') not like ${SCRIPTING_TASK_PREFIX + "%"}`,
      sql`coalesce(${tasks.dedupeKey}, '') not like ${REVIEW_PREFIX + "%"}`,
    ))
    .returning({ title: tasks.title });
  return { count: rows.length, titles: rows.map((r) => r.title) };
}

/** Scriptingtaken van alle (ook toekomstige) opnames van deze klant gelijktrekken. */
async function resyncScripting(clientId: string): Promise<{ created: number; closed: number }> {
  const days = await db
    .select({ id: productionDays.id })
    .from(productionDays)
    .where(and(eq(productionDays.clientId, clientId), gte(productionDays.scheduledOn, todayAmsterdam())));
  const withTask = await db
    .select({ id: tasks.entityId })
    .from(tasks)
    .where(and(eq(tasks.clientId, clientId), like(tasks.dedupeKey, `${SCRIPTING_TASK_PREFIX}%`), isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN_TASK])));
  const ids = [...new Set([...days.map((d) => d.id), ...withTask.map((t) => t.id).filter((x): x is string => !!x)])];
  if (ids.length === 0) return { created: 0, closed: 0 };
  const r = await syncScriptingTasks(ids);
  return { created: r.created + r.reopened, closed: r.closed };
}

async function muteNotifications(clientId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.clientId, clientId),
      isNull(notifications.readAt),
      notInArray(notifications.type, [...MANUAL_NOTIFICATION_TYPES]),
    ))
    .returning({ id: notifications.id });
  return rows.length;
}

async function stopQueuedReports(clientId: string, statuses: ("gegevens_verzamelen" | "analyse_bezig")[] = ["gegevens_verzamelen", "analyse_bezig"]): Promise<number> {
  const rows = await db
    .update(clientReports)
    .set({
      status: "mislukt",
      startedAt: null,
      errorMessage: "Niet gegenereerd: de klant staat op niet actief. Zet de klant weer op actief of start het rapport handmatig.",
      updatedAt: new Date(),
    })
    .where(and(
      eq(clientReports.clientId, clientId),
      isNull(clientReports.deletedAt),
      inArray(clientReports.status, statuses),
    ))
    .returning({ id: clientReports.id });
  return rows.length;
}

/** Eén beoordelingstaak met al het lopende werk, zodat niets ongemerkt blijft liggen. */
async function createReviewTask(
  client: { id: string; name: string; slug: string; coordinatorId: string | null },
  cancelled: string[],
): Promise<string | null> {
  const today = todayAmsterdam();
  const [manualTasks, videos, shoots] = await Promise.all([
    db.select({ title: tasks.title }).from(tasks).where(and(
      eq(tasks.clientId, client.id), isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN_TASK]),
      ne(tasks.source, "automation"),
      sql`coalesce(${tasks.dedupeKey}, '') not like ${REVIEW_PREFIX + "%"}`,
    )),
    db.select({ title: deliverables.title, status: deliverables.status }).from(deliverables).where(and(
      eq(deliverables.clientId, client.id), isNull(deliverables.deletedAt), notInArray(deliverables.status, [...DONE_VIDEO]),
    )),
    db.select({ on: productionDays.scheduledOn }).from(productionDays).where(and(
      eq(productionDays.clientId, client.id), isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled"), gte(productionDays.scheduledOn, today),
    )),
  ]);

  const open = manualTasks.length + videos.length + shoots.length;
  if (open === 0 && cancelled.length === 0) return null;

  const list = (items: string[], max = 8) => items.slice(0, max).map((t) => `- ${t}`).join("\n") + (items.length > max ? `\n- … en ${items.length - max} meer` : "");
  const parts: string[] = [`${client.name} staat op niet actief. Automatische processen, controles en meldingen voor deze klant zijn gestopt. Bekijk het lopende werk en beslis per onderdeel: afronden, annuleren of laten staan.`];
  if (videos.length) parts.push(`Video's nog in productie (${videos.length}):\n${list(videos.map((v) => v.title))}`);
  if (shoots.length) parts.push(`Ingeplande opnames (${shoots.length}):\n${list(shoots.map((s) => s.on))}`);
  if (manualTasks.length) parts.push(`Open handmatige taken (${manualTasks.length}):\n${list(manualTasks.map((t) => t.title))}`);
  if (cancelled.length) parts.push(`Automatisch geannuleerd (${cancelled.length}):\n${list(cancelled)}`);
  parts.push(`Klantpagina: /clients/${client.slug}`);

  let assigneeId = client.coordinatorId;
  if (!assigneeId) {
    const [owner] = await db.select({ id: users.id }).from(users).where(and(eq(users.primaryRole, "owner"), isNull(users.deletedAt))).limit(1);
    assigneeId = owner?.id ?? null;
  }

  const [row] = await db
    .insert(tasks)
    .values({
      clientId: client.id,
      title: `${client.name}: niet actief, lopend werk beoordelen`.slice(0, 240),
      description: parts.join("\n\n"),
      status: "todo",
      priority: "high",
      category: "klantcontact",
      assigneeId,
      dueOn: today,
      entityType: "client",
      entityId: client.id,
      source: "manual",
      dedupeKey: `${REVIEW_PREFIX}${client.id}`,
    })
    .onConflictDoNothing()
    .returning({ id: tasks.id });

  if (row && assigneeId) {
    await notify({
      userIds: [assigneeId],
      clientId: client.id,
      type: "client_status_review",
      level: "warning",
      title: `${client.name} staat op niet actief`,
      body: `Er staat nog lopend werk open (${open} onderdelen). Beoordeel of het moet worden afgerond of geannuleerd.`,
      href: `/tasks`,
      entityType: "client",
      entityId: client.id,
      dedupeKey: `client_status_review:${client.id}:${today}`,
    });
  }
  return row?.id ?? null;
}

async function closeReviewTask(clientId: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      dedupeKey: sql`left(${tasks.dedupeKey}, 140) || ':heractiveerd:' || ${tasks.id}::text`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(tasks.clientId, clientId),
      eq(tasks.dedupeKey, `${REVIEW_PREFIX}${clientId}`),
      inArray(tasks.status, [...OPEN_TASK]),
    ));
}

/**
 * Verwerkt een statuswissel. `from` is de status vóór de wijziging. Veilig om
 * vaker aan te roepen: alle stappen zijn idempotent.
 */
export async function applyClientStatusTransition(clientId: string, from: string | null, to: string): Promise<TransitionResult> {
  const result: TransitionResult = {
    direction: "none", cancelledTasks: 0, scriptingClosed: 0, scriptingCreated: 0, mutedNotifications: 0, stoppedReports: 0, reviewTaskId: null,
  };
  const [client] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return result;

  if (isInactiveClientStatus(to) && !isInactiveClientStatus(from)) {
    result.direction = "deactivated";
    const cancelled = await cancelAutomaticTasks(clientId);
    result.cancelledTasks = cancelled.count;
    const s = await resyncScripting(clientId);
    result.scriptingClosed = s.closed;
    result.mutedNotifications = await muteNotifications(clientId);
    result.stoppedReports = await stopQueuedReports(clientId);
    result.reviewTaskId = await createReviewTask(client, cancelled.titles);
  } else if (isActiveClientStatus(to) && !isActiveClientStatus(from)) {
    result.direction = "reactivated";
    await closeReviewTask(clientId);
    const s = await resyncScripting(clientId);
    result.scriptingCreated = s.created;
  }
  return result;
}

/**
 * Nachtelijk vangnet: voor alle niet actieve klanten open automatische taken
 * opruimen die er (bijv. via een handmatige actie) toch nog zijn bijgekomen.
 * Maakt geen beoordelingstaken of meldingen aan.
 */
export async function sweepInactiveClients(): Promise<{ clients: number; cancelledTasks: number; scriptingClosed: number; stoppedReports: number }> {
  const inactive = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, [...INACTIVE_CLIENT_STATUSES])));
  let cancelledTasks = 0;
  let scriptingClosed = 0;
  let stoppedReports = 0;
  for (const c of inactive) {
    cancelledTasks += (await cancelAutomaticTasks(c.id)).count;
    scriptingClosed += (await resyncScripting(c.id)).closed;
    // Alleen de wachtrij; een handmatig gestarte generatie (analyse_bezig) mag afronden.
    stoppedReports += await stopQueuedReports(c.id, ["gegevens_verzamelen"]);
  }
  return { clients: inactive.length, cancelledTasks, scriptingClosed, stoppedReports };
}
