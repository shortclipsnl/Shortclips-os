import "server-only";
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { clientFeedbackRounds, clients, deliverables, productionDays, scriptReviews, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { notInactiveClient } from "@/server/client-activity";
import { getFeedbackDaysByClient } from "@/server/portal-settings";
import { nlHolidaySet } from "@/lib/holidays";
import {
  amsterdamDay,
  deadlineLabel,
  feedbackDueDay,
  waitingStatus,
  workdaysLabel,
  type FeedbackStatusKey,
} from "@/lib/feedback-deadline";

/* ------------------------------------------------------------------ *
 * Termijn + exacte deadline voor het scriptbericht (Scripting)
 * ------------------------------------------------------------------ */

/**
 * Per opname de feedbacktermijn van de klant en de exacte deadline voor in het
 * WhatsApp-scriptbericht. Liggen de scripts al bij de klant in het portaal en
 * is die deadline nog niet voorbij, dan nemen we precies die deadline over;
 * anders rekenen we met de termijn van de klant vanaf vandaag.
 */
export async function scriptberichtTermijnen(
  rows: Array<{ id: string; clientId: string; reviewId: string | null }>,
): Promise<Map<string, { termijn: string; deadline: string }>> {
  const out = new Map<string, { termijn: string; deadline: string }>();
  if (!rows.length) return out;
  const holidays = nlHolidaySet();
  const today = amsterdamDay(new Date());
  const reviewIds = rows.map((r) => r.reviewId).filter((x): x is string => !!x);
  const [days, reviews] = await Promise.all([
    getFeedbackDaysByClient(rows.map((r) => r.clientId)),
    reviewIds.length
      ? db.select({ id: scriptReviews.id, status: scriptReviews.status, feedbackDeadline: scriptReviews.feedbackDeadline }).from(scriptReviews).where(inArray(scriptReviews.id, reviewIds))
      : Promise.resolve([] as Array<{ id: string; status: string; feedbackDeadline: Date | null }>),
  ]);
  const reviewById = new Map(reviews.map((r) => [r.id, r]));
  for (const r of rows) {
    const term = days.get(r.clientId)?.scripts ?? 3;
    const rev = r.reviewId ? reviewById.get(r.reviewId) : null;
    const lopend = rev?.feedbackDeadline && ["klaar_controle", "opnieuw_controle"].includes(rev.status) && amsterdamDay(rev.feedbackDeadline) >= today
      ? amsterdamDay(rev.feedbackDeadline)
      : null;
    out.set(r.id, { termijn: workdaysLabel(term), deadline: deadlineLabel(lopend ?? feedbackDueDay(new Date(), term, holidays)) });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Feedbackstatus per klant (blok op de interne klantenpagina)
 * ------------------------------------------------------------------ */

export type FeedbackStatusRow = {
  key: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  /** "Scripts opname 26 nov" · "Video's opname 12 nov" · "Video's, correctieversie". */
  onderdeel: string;
  kind: "scripts" | "videos";
  /** Laatste dag van de termijn (YYYY-MM-DD); null als de klant niet meer aan zet is. */
  dueDay: string | null;
  status: FeedbackStatusKey;
  responsibleId: string | null;
  responsibleName: string | null;
  href: string;
};

const MONTH = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const shortDay = (iso: string | null) => {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTH[(m ?? 1) - 1]}`;
};
const VIDEO_DONE = ["approved", "ready_to_publish", "scheduled", "published", "analysis_available"];

/**
 * Alles wat op klantfeedback wacht of net binnen is, voor scripts en video's
 * samen. Afgeleid van de bestaande scriptcontrole en feedbackrondes: geen eigen
 * administratie, dus altijd gelijk aan Scripting, Editing en het klantportaal.
 */
export async function getFeedbackStatusOverview(viewer: Viewer): Promise<FeedbackStatusRow[]> {
  const holidays = nlHolidaySet();
  const today = amsterdamDay(new Date());
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const rows: FeedbackStatusRow[] = [];

  // ---- Scripts ----
  const reviews = await db
    .select({
      id: scriptReviews.id,
      clientId: scriptReviews.clientId,
      status: scriptReviews.status,
      feedbackDeadline: scriptReviews.feedbackDeadline,
      updatedAt: scriptReviews.updatedAt,
      shootOn: productionDays.scheduledOn,
      clientName: clients.name,
      clientSlug: clients.slug,
      coordinatorId: clients.coordinatorId,
      coordinatorName: users.fullName,
    })
    .from(scriptReviews)
    .innerJoin(clients, eq(clients.id, scriptReviews.clientId))
    .leftJoin(productionDays, eq(productionDays.id, scriptReviews.productionDayId))
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(
      isNull(scriptReviews.deletedAt),
      notInactiveClient(scriptReviews.clientId),
      scopeToClients(viewer, scriptReviews.clientId),
      or(
        inArray(scriptReviews.status, ["klaar_controle", "opnieuw_controle", "feedback_gegeven", "wordt_aangepast"]),
        and(eq(scriptReviews.status, "goedgekeurd"), gte(scriptReviews.updatedAt, weekAgo)),
      ),
    ));
  const scriptDays = await getFeedbackDaysByClient(reviews.map((r) => r.clientId));
  for (const r of reviews) {
    const waiting = r.status === "klaar_controle" || r.status === "opnieuw_controle";
    // Opnames die al geweest zijn horen niet meer in de bewaking.
    if (waiting && r.shootOn && r.shootOn < today) continue;
    const dueDay = waiting
      ? r.feedbackDeadline
        ? amsterdamDay(r.feedbackDeadline)
        : feedbackDueDay(r.updatedAt, scriptDays.get(r.clientId)?.scripts ?? 3, holidays)
      : null;
    rows.push({
      key: `s:${r.id}`,
      clientId: r.clientId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      onderdeel: `Scripts${r.shootOn ? ` opname ${shortDay(r.shootOn)}` : ""}${r.status === "opnieuw_controle" ? ", aangepaste versie" : ""}`,
      kind: "scripts",
      dueDay,
      status: waiting ? waitingStatus(dueDay!, today, holidays) : r.status === "goedgekeurd" ? "afgerond" : "ontvangen",
      responsibleId: r.coordinatorId,
      responsibleName: r.coordinatorName,
      href: `/scriptcontrole/${r.id}`,
    });
  }

  // ---- Video's: per klant en opname één regel ----
  const videos = await db
    .select({
      id: deliverables.id,
      clientId: deliverables.clientId,
      status: deliverables.status,
      dayId: deliverables.productionDayId,
      shootOn: productionDays.scheduledOn,
      roundId: clientFeedbackRounds.id,
      roundNumber: clientFeedbackRounds.roundNumber,
      dueOn: clientFeedbackRounds.dueOn,
      endedAt: clientFeedbackRounds.endedAt,
      clientName: clients.name,
      clientSlug: clients.slug,
      coordinatorId: clients.coordinatorId,
      coordinatorName: users.fullName,
    })
    .from(clientFeedbackRounds)
    .innerJoin(deliverables, eq(deliverables.id, clientFeedbackRounds.deliverableId))
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(productionDays, eq(productionDays.id, deliverables.productionDayId))
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(
      isNull(deliverables.deletedAt),
      notInactiveClient(deliverables.clientId),
      scopeToClients(viewer, deliverables.clientId),
      or(isNull(clientFeedbackRounds.endedAt), gte(clientFeedbackRounds.endedAt, weekAgo)),
    ));

  type Group = { first: (typeof videos)[number]; open: typeof videos; revision: boolean; done: boolean; correction: boolean };
  const groups = new Map<string, Group>();
  for (const v of videos) {
    const key = `${v.clientId}:${v.dayId ?? v.id}`;
    const g = groups.get(key) ?? { first: v, open: [], revision: false, done: false, correction: false };
    if (v.endedAt == null && v.status === "client_review") {
      g.open.push(v);
      if (v.roundNumber > 1) g.correction = true;
    } else if (v.status === "client_revision") g.revision = true;
    else if (VIDEO_DONE.includes(v.status)) g.done = true;
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    const v = g.first;
    let status: FeedbackStatusKey;
    let dueDay: string | null = null;
    if (g.open.length) {
      dueDay = g.open.map((o) => String(o.dueOn).slice(0, 10)).sort()[0]!;
      status = waitingStatus(dueDay, today, holidays);
    } else if (g.revision) status = "ontvangen";
    else if (g.done) status = "afgerond";
    else continue;
    rows.push({
      key: `v:${key}`,
      clientId: v.clientId,
      clientName: v.clientName,
      clientSlug: v.clientSlug,
      onderdeel: `Video's${v.shootOn ? ` opname ${shortDay(v.shootOn)}` : ""}${g.correction ? ", correctieversie" : ""}`,
      kind: "videos",
      dueDay,
      status,
      responsibleId: v.coordinatorId,
      responsibleName: v.coordinatorName,
      href: `/videos?klant=${v.clientSlug}`,
    });
  }
  return rows;
}
