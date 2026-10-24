import "server-only";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, tasks, deadlineMisses } from "@/db/schema";
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
    ));

  // Nu te laat volgens de prestatieregistratie (team-breed).
  const [lateRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deadlineMisses)
    .where(eq(deadlineMisses.resolved, false));

  return {
    overdueVideos: overdue.length,
    atClient: Number(atClientRow?.n ?? 0),
    myOpenTasks: Number(myTasksRow?.n ?? 0),
    currentlyLate: Number(lateRow?.n ?? 0),
    topOverdue: overdue.slice(0, 4),
  };
}
