import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { productionDays, scripts, users } from "@/db/schema";
import { type Viewer } from "@/server/auth/context";
import { upcomingAppointmentsForClient } from "@/server/appointments";
import { listPortalScriptReviews, SCRIPT_REVIEW_STATUS, type ScriptReviewStatus } from "@/server/script-review";

export type PlanningPerson = { name: string; role: string | null; avatarUrl: string | null };

export type PortalScriptState = { label: string; tone: "warn" | "info" | "good" | "neutral" };

export type PortalOpname = {
  id: string;
  title: string;
  date: string; // scheduled_on (YYYY-MM-DD)
  startTime: string | null; // HH:MM
  endTime: string | null;
  location: string | null;
  plannedShorts: number | null;
  /** Aantal scripts dat aan deze opnamedag hangt (uit de scripts-tabel). */
  scriptCount: number;
  contentCreative: PlanningPerson | null;
  videographer: PlanningPerson | null;
  reviewId: string | null;
  script: PortalScriptState;
};

export type PortalScriptMeeting = {
  id: string;
  startsAt: string; // ISO
  endsAt: string | null;
  allDay: boolean;
  title: string;
  link: string | null;
  people: string[];
};

export type PortalPlanning = {
  nextOpname: PortalOpname | null;
  laterOpnames: PortalOpname[];
  scriptMeetings: PortalScriptMeeting[];
  pastOpnames: PortalOpname[];
};

const INTERNAL_RE = /(shortclips\.nl|teamshortclips@gmail\.com|jarnoklijnsma9@gmail\.com)/i;

/** Interne Shortclips-deelnemers uit een agenda-afspraak (voor scriptmeetings). */
function shortclipsPeople(attendees: unknown): string[] {
  if (!Array.isArray(attendees)) return [];
  const names = new Set<string>();
  for (const a of attendees as Array<{ email?: string | null; displayName?: string | null }>) {
    if (!a?.email || !INTERNAL_RE.test(a.email)) continue;
    const name = (a.displayName ?? a.email.split("@")[0] ?? "").replace(/\s*-?\s*shortclips.*/i, "").trim();
    if (name) names.add(name);
  }
  return [...names];
}

const hhmm = (t: string | null): string | null => (t ? t.slice(0, 5) : null);

/** Client-facing scriptstatus voor een opname op basis van de review (indien er al één is). */
function scriptStateFor(status: ScriptReviewStatus | null): PortalScriptState {
  if (!status) return { label: "Scripts worden voorbereid", tone: "neutral" };
  const meta = SCRIPT_REVIEW_STATUS[status];
  return { label: meta.label, tone: meta.tone };
}

/**
 * Planning van de klant: opnames (uit production_days — de interne bron, incl.
 * medewerkers, locatie, aantal shorts en gekoppelde scripts) plus toekomstige
 * scriptmeetings (uit de gekoppelde Google Agenda). Hard gescoped op de eigen
 * klant; er wordt niets gewijzigd aan agenda's of afspraken.
 */
export async function getPortalPlanning(viewer: Viewer): Promise<PortalPlanning> {
  const clientId = viewer.clientId;
  if (!clientId) return { nextOpname: null, laterOpnames: [], scriptMeetings: [], pastOpnames: [] };
  const today = new Date().toISOString().slice(0, 10);

  const [future, past, reviews, appts] = await Promise.all([
    db
      .select({
        id: productionDays.id, title: productionDays.title, scheduledOn: productionDays.scheduledOn,
        startTime: productionDays.startTime, endTime: productionDays.endTime,
        locationName: productionDays.locationName, plannedShorts: productionDays.plannedShorts,
        coordinatorId: productionDays.coordinatorId, scriptWriterId: productionDays.scriptWriterId, videographerId: productionDays.videographerId,
      })
      .from(productionDays)
      .where(and(eq(productionDays.clientId, clientId), isNull(productionDays.deletedAt), gte(productionDays.scheduledOn, today), ne(productionDays.status, "cancelled")))
      .orderBy(asc(productionDays.scheduledOn)),
    db
      .select({
        id: productionDays.id, title: productionDays.title, scheduledOn: productionDays.scheduledOn,
        startTime: productionDays.startTime, endTime: productionDays.endTime,
        locationName: productionDays.locationName, plannedShorts: productionDays.plannedShorts,
        coordinatorId: productionDays.coordinatorId, scriptWriterId: productionDays.scriptWriterId, videographerId: productionDays.videographerId,
      })
      .from(productionDays)
      .where(and(eq(productionDays.clientId, clientId), isNull(productionDays.deletedAt), lt(productionDays.scheduledOn, today), ne(productionDays.status, "cancelled")))
      .orderBy(desc(productionDays.scheduledOn))
      .limit(8),
    listPortalScriptReviews(viewer),
    upcomingAppointmentsForClient(clientId, 30),
  ]);

  const reviewByDay = new Map(reviews.map((r) => [r.productionDayId, r]));

  // Namen/avatars van de betrokken medewerkers in één keer ophalen.
  const rows = [...future, ...past];

  // Aantal scripts per opnamedag (echte telling uit de scripts-tabel).
  const dayIds = rows.map((r) => r.id);
  const scriptRows = dayIds.length
    ? await db
        .select({ dayId: scripts.productionDayId, n: sql<number>`count(*)::int` })
        .from(scripts)
        .where(and(inArray(scripts.productionDayId, dayIds), isNull(scripts.deletedAt)))
        .groupBy(scripts.productionDayId)
    : [];
  const scriptCountByDay = new Map(scriptRows.map((r) => [r.dayId ?? "", Number(r.n)]));
  const ids = [...new Set(rows.flatMap((r) => [r.coordinatorId, r.scriptWriterId, r.videographerId]).filter((x): x is string => !!x))];
  const people = ids.length ? await db.select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, ids)) : [];
  const personById = new Map(people.map((p) => [p.id, p]));
  const toPerson = (id: string | null, role: string): PlanningPerson | null => {
    if (!id) return null;
    const u = personById.get(id);
    return u ? { name: u.fullName, role, avatarUrl: u.avatarUrl } : null;
  };

  const mapOpname = (r: (typeof rows)[number]): PortalOpname => {
    const review = reviewByDay.get(r.id) ?? null;
    return {
      id: r.id,
      title: r.title,
      date: r.scheduledOn,
      startTime: hhmm(r.startTime),
      endTime: hhmm(r.endTime),
      location: r.locationName ?? null,
      plannedShorts: r.plannedShorts ?? null,
      scriptCount: scriptCountByDay.get(r.id) ?? 0,
      // Content creative = coördinator die de opname draait (valt terug op de scriptschrijver).
      contentCreative: toPerson(r.coordinatorId ?? r.scriptWriterId, "Content creative"),
      videographer: toPerson(r.videographerId, "Videograaf"),
      reviewId: review?.id ?? null,
      script: scriptStateFor(review?.status ?? null),
    };
  };

  const futureOpnames = future.map(mapOpname);
  const pastOpnames = past.map(mapOpname);

  const scriptMeetings: PortalScriptMeeting[] = appts
    .filter((a) => a.kind === "scriptbespreking")
    .map((a) => ({
      id: a.id,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt ? a.endsAt.toISOString() : null,
      allDay: a.allDay,
      title: a.title ?? "Scriptmeeting",
      link: a.htmlLink ?? null,
      people: shortclipsPeople(a.attendees),
    }));

  return {
    nextOpname: futureOpnames[0] ?? null,
    laterOpnames: futureOpnames.slice(1),
    scriptMeetings,
    pastOpnames,
  };
}
