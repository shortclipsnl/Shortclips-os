import "server-only";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, scripts, tasks, deadlineMisses } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { nlHolidaySet } from "@/lib/holidays";
import { internalDeadline, isFirstVersionPending } from "@/lib/edit-deadline";
import { getDeadlineSettings } from "@/server/deadline-settings";

const FV_STAGES = ["recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision"] as const;
const today = () => new Date().toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export type MorningOverview = {
  overdueVideos: number;
  atClient: number;
  myOpenTasks: number;
  currentlyLate: number;
  topOverdue: Array<{ id: string; label: string; daysLate: number }>;
  /** Klanten die nog moeten reageren (video's/scripts), met dagen-wachtend. */
  clientsWaiting: Array<{ id: string; kind: "video" | "script"; clientName: string; title: string; days: number; href: string }>;
};

/**
 * Eén gebundeld ochtendoverzicht voor het dashboard: verlopen deadlines,
 * openstaande acties en wat aandacht vraagt — in één blik, i.p.v. verspreid over
 * meerdere blokken. Gescoped op de klanten die de viewer mag zien.
 */
export async function getMorningOverview(viewer: Viewer): Promise<MorningOverview> {
  const t = today();
  const holidays = nlHolidaySet();
  const settings = await getDeadlineSettings();

  // Video's in de eerste-versie-fase: interne deadline in JS berekenen.
  const dels = await db
    .select({ id: deliverables.id, title: deliverables.title, status: deliverables.status, shootOn: deliverables.shootOn, dueOn: deliverables.dueOn, clientName: clients.name })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, [...FV_STAGES]), scopeToClients(viewer, deliverables.clientId) ?? undefined));

  const overdue: Array<{ id: string; label: string; daysLate: number }> = [];
  for (const d of dels) {
    if (!isFirstVersionPending(d.status)) continue;
    const internal = internalDeadline(d.shootOn, d.dueOn, holidays);
    if (!internal || internal >= t) continue;
    overdue.push({ id: d.id, label: `${d.clientName} — ${d.title}`, daysLate: dayDiff(t, internal) });
  }
  overdue.sort((a, b) => b.daysLate - a.daysLate);

  // Video's die op klantfeedback wachten (langer dan de ingestelde termijn).
  const feedbackDays = settings["deadline.clientFeedbackDays"];
  const [atClientRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deliverables)
    .where(and(
      isNull(deliverables.deletedAt),
      inArray(deliverables.status, ["client_review", "client_revision"]),
      sql`${deliverables.statusChangedAt} < now() - (${feedbackDays} * interval '1 day')`,
      scopeToClients(viewer, deliverables.clientId) ?? undefined,
    ));

  // Eigen openstaande taken vandaag of te laat.
  const [myTasksRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(
      isNull(tasks.deletedAt),
      eq(tasks.assigneeId, viewer.id),
      inArray(tasks.status, ["todo", "in_progress", "blocked"]),
      lte(tasks.dueOn, t),
      sql`${tasks.dueOn} is not null`,
      // Automatisch gegenereerde AI-verbeterpunten niet meetellen.
      sql`not (${tasks.source} = 'automation' and ${tasks.entityType} = 'ai_insight')`,
    ));

  // Nu te laat volgens de prestatieregistratie (team-breed).
  const [lateRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deadlineMisses)
    .where(eq(deadlineMisses.resolved, false));

  // Welke klanten moeten nog reageren: video's én scripts die bij de klant
  // liggen (client_review), met hoeveel dagen ze er al liggen.
  const [waitVideos, waitScripts] = await Promise.all([
    db.select({ id: deliverables.id, title: deliverables.title, since: deliverables.statusChangedAt, clientName: clients.name })
      .from(deliverables).innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(and(isNull(deliverables.deletedAt), eq(deliverables.status, "client_review"), scopeToClients(viewer, deliverables.clientId) ?? undefined)),
    db.select({ id: scripts.id, title: scripts.title, since: scripts.updatedAt, clientName: clients.name })
      .from(scripts).innerJoin(clients, eq(clients.id, scripts.clientId))
      .where(and(isNull(scripts.deletedAt), eq(scripts.status, "client_review"), scopeToClients(viewer, scripts.clientId) ?? undefined)),
  ]);
  const toDay = (d: Date | string | null): string => (d ? (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10) : t);
  const clientsWaiting = [
    ...waitVideos.map((v) => ({ id: v.id, kind: "video" as const, clientName: v.clientName, title: v.title, days: Math.max(0, dayDiff(t, toDay(v.since))), href: `/videos/${v.id}` })),
    ...waitScripts.map((s) => ({ id: s.id, kind: "script" as const, clientName: s.clientName, title: s.title, days: Math.max(0, dayDiff(t, toDay(s.since))), href: `/scripts/${s.id}` })),
  ].sort((a, b) => b.days - a.days);

  return {
    overdueVideos: overdue.length,
    atClient: Number(atClientRow?.n ?? 0),
    myOpenTasks: Number(myTasksRow?.n ?? 0),
    currentlyLate: Number(lateRow?.n ?? 0),
    topOverdue: overdue.slice(0, 4),
    clientsWaiting: clientsWaiting.slice(0, 8),
  };
}
