import "server-only";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, planningDeadlines, scripts, users } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { scopeToClients } from "@/server/auth/context";
import { addDaysIso, DEADLINE_DAYS, deadlineView, todayAmsterdam, type DeadlineView } from "@/lib/planning-deadline";

/**
 * Datalaag voor de contentplanning-deadline (21 dagen). Eén bron voor het
 * klantportaal, het interne overzicht en de herinneringen.
 *
 * Wat telt als "actie van de klant": scripts die op akkoord wachten en video's
 * die op feedback wachten (dezelfde bron als "Jouw acties" in het portaal).
 * Afgerond = automatisch zodra er tijdens de deadline iets bij de klant lag en
 * nu niets meer openstaat, of handmatig door het team.
 */

export type DeadlineRow = typeof planningDeadlines.$inferSelect;
export type HistoryEntry = { at: string; byName: string; action: string; from?: string; to?: string; reason?: string };

/** Video-statussen waarin de klant zijn feedback heeft gegeven (of akkoord is). */
const VIDEO_AFTER_FEEDBACK = ["client_revision", "approved", "ready_to_publish", "scheduled", "published", "analysis_available"] as const;

export type ClientActions = {
  scriptsOpen: number;
  videosOpen: number;
  scriptsDone: number;
  videosDone: number;
};

async function clientActions(clientIds: string[], sinceByClient: Map<string, string>): Promise<Map<string, ClientActions>> {
  const out = new Map<string, ClientActions>();
  for (const id of clientIds) out.set(id, { scriptsOpen: 0, videosOpen: 0, scriptsDone: 0, videosDone: 0 });
  if (clientIds.length === 0) return out;
  const [scr, vid] = await Promise.all([
    db
      .select({ clientId: scripts.clientId, status: scripts.status, approvedAt: scripts.approvedAt })
      .from(scripts)
      .where(and(inArray(scripts.clientId, clientIds), isNull(scripts.deletedAt), or(eq(scripts.status, "client_review"), sql`${scripts.approvedAt} is not null`))),
    db
      .select({ clientId: deliverables.clientId, status: deliverables.status, changedAt: deliverables.statusChangedAt })
      .from(deliverables)
      .where(and(inArray(deliverables.clientId, clientIds), isNull(deliverables.deletedAt), inArray(deliverables.status, ["client_review", ...VIDEO_AFTER_FEEDBACK]))),
  ]);
  const sinceTs = (clientId: string) => Date.parse(`${sinceByClient.get(clientId) ?? "9999-12-31"}T00:00:00+01:00`);
  for (const s of scr) {
    const a = out.get(s.clientId);
    if (!a) continue;
    if (s.status === "client_review") a.scriptsOpen++;
    else if (s.approvedAt && s.approvedAt.getTime() >= sinceTs(s.clientId)) a.scriptsDone++;
  }
  for (const v of vid) {
    if (!v.clientId) continue;
    const a = out.get(v.clientId);
    if (!a) continue;
    if (v.status === "client_review") a.videosOpen++;
    else if (v.changedAt && v.changedAt.getTime() >= sinceTs(v.clientId)) a.videosDone++;
  }
  return out;
}

/**
 * Start een deadline van 21 dagen als er voor deze klant nog geen loopt.
 * Idempotent dankzij de unieke index op één actieve deadline per klant.
 */
export async function startDeadlineIfNone(clientId: string, startedById: string | null, now = new Date()): Promise<boolean> {
  const today = todayAmsterdam(now);
  const inserted = await db
    .insert(planningDeadlines)
    .values({ clientId, startedOn: today, deadlineOn: addDaysIso(today, DEADLINE_DAYS), startedById })
    .onConflictDoNothing()
    .returning({ id: planningDeadlines.id });
  return inserted.length > 0;
}

/**
 * Werkt actieve deadlines bij: onthoudt of er iets bij de klant lag en rondt
 * automatisch af zodra dat weer allemaal is afgehandeld. Raakt nooit
 * publicatiedatums of publicatieautomatiseringen.
 */
export async function evaluateDeadlines(clientIds?: string[]): Promise<{ completed: number }> {
  const rows = await db
    .select()
    .from(planningDeadlines)
    .where(and(eq(planningDeadlines.status, "active"), isNull(planningDeadlines.deletedAt), clientIds ? inArray(planningDeadlines.clientId, clientIds) : undefined));
  if (rows.length === 0) return { completed: 0 };
  const actions = await clientActions(rows.map((r) => r.clientId), new Map(rows.map((r) => [r.clientId, r.startedOn])));
  let completed = 0;
  for (const r of rows) {
    const a = actions.get(r.clientId)!;
    const open = a.scriptsOpen + a.videosOpen;
    if (open > 0 && !r.hadClientActions) {
      await db.update(planningDeadlines).set({ hadClientActions: true, updatedAt: new Date() }).where(eq(planningDeadlines.id, r.id));
    } else if (open === 0 && r.hadClientActions) {
      const history = [...((r.history as HistoryEntry[]) ?? []), { at: new Date().toISOString(), byName: "Automatisch", action: "afgerond" }];
      await db
        .update(planningDeadlines)
        .set({ status: "completed", completedAt: new Date(), completedVia: "auto", history, updatedAt: new Date() })
        .where(and(eq(planningDeadlines.id, r.id), eq(planningDeadlines.status, "active")));
      completed++;
    }
  }
  return { completed };
}

export type ClientDeadline = {
  id: string;
  view: DeadlineView;
  actions: ClientActions;
  completedVia: string | null;
};

/** Actieve deadline, of de laatst afgeronde van de afgelopen 14 dagen. */
export async function loadClientDeadline(clientId: string, now = new Date()): Promise<ClientDeadline | null> {
  await evaluateDeadlines([clientId]);
  const today = todayAmsterdam(now);
  const [row] = await db
    .select()
    .from(planningDeadlines)
    .where(and(eq(planningDeadlines.clientId, clientId), isNull(planningDeadlines.deletedAt)))
    .orderBy(sql`case when ${planningDeadlines.status} = 'active' then 0 else 1 end`, desc(planningDeadlines.startedOn), desc(planningDeadlines.createdAt))
    .limit(1);
  if (!row) return null;
  if (row.status === "completed" && row.completedAt && now.getTime() - row.completedAt.getTime() > 14 * 86_400_000) return null;
  const actions = (await clientActions([clientId], new Map([[clientId, row.startedOn]]))).get(clientId)!;
  return { id: row.id, view: deadlineView(row, today), actions, completedVia: row.completedVia };
}

export type TeamDeadlineRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  view: DeadlineView;
  actions: ClientActions;
  completedVia: string | null;
  lastChange: HistoryEntry | null;
};

/** Intern overzicht: alle actieve deadlines plus recent afgeronde (14 dagen), binnen de klantscope. */
export async function listTeamDeadlines(viewer: Viewer, now = new Date()): Promise<TeamDeadlineRow[]> {
  await evaluateDeadlines();
  const today = todayAmsterdam(now);
  const recent = new Date(now.getTime() - 14 * 86_400_000);
  const rows = await db
    .select({ d: planningDeadlines, clientName: clients.name, clientSlug: clients.slug })
    .from(planningDeadlines)
    .innerJoin(clients, eq(clients.id, planningDeadlines.clientId))
    .where(and(
      isNull(planningDeadlines.deletedAt),
      isNull(clients.deletedAt),
      or(eq(planningDeadlines.status, "active"), gte(planningDeadlines.completedAt, recent)),
      scopeToClients(viewer, planningDeadlines.clientId),
    ));
  const actions = await clientActions(rows.map((r) => r.d.clientId), new Map(rows.map((r) => [r.d.clientId, r.d.startedOn])));
  return rows.map((r) => {
    const hist = (r.d.history as HistoryEntry[]) ?? [];
    return {
      id: r.d.id,
      clientId: r.d.clientId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      view: deadlineView(r.d, today),
      actions: actions.get(r.d.clientId)!,
      completedVia: r.d.completedVia,
      lastChange: hist.length ? hist[hist.length - 1]! : null,
    };
  });
}

/** Sorteert op kortste resterende tijd; afgeronde onderaan. */
export function sortByUrgency(rows: TeamDeadlineRow[]): TeamDeadlineRow[] {
  return [...rows].sort((a, b) => Number(a.view.done) - Number(b.view.done) || a.view.daysLeft - b.view.daysLeft || a.clientName.localeCompare(b.clientName, "nl"));
}

export async function activeDeadlineFor(clientId: string): Promise<DeadlineRow | null> {
  const [row] = await db
    .select()
    .from(planningDeadlines)
    .where(and(eq(planningDeadlines.clientId, clientId), eq(planningDeadlines.status, "active"), isNull(planningDeadlines.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function userName(id: string): Promise<string> {
  const [u] = await db.select({ n: users.fullName }).from(users).where(eq(users.id, id)).limit(1);
  return u?.n ?? "Onbekend";
}
