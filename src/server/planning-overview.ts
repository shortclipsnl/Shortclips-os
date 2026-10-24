import "server-only";
import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCalendar, deliverables, leaveRequests, productionDays, teamMeetings, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";

/**
 * Productieoverzicht voor de komende N weken (Deel 4): opnames, opleveringen
 * (deadlines) en publicaties per week gebucket, plus verlof en een eenvoudige
 * conflictsignalering (editor met veel opleveringen in één week). Alles klant-
 * gescoopt; puur lezen uit bestaande tabellen.
 */

export type PlanItem = { id: string; kind: "opname" | "oplevering" | "publicatie"; date: string; clientName: string; clientColor: string | null; clientLogo: string | null; title: string; person: string | null; href: string };
export type PlanMeeting = { id: string; title: string; date: string; time: string; location: string | null };
export type PlanWeek = {
  key: string; label: string; weekNumber: number; startOn: string; endOn: string;
  opnames: PlanItem[]; opleveringen: PlanItem[]; publicaties: PlanItem[]; meetings: PlanMeeting[];
  conflicts: Array<{ editor: string; count: number }>;
  leave: Array<{ name: string; startOn: string; endOn: string }>;
};

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0 = maandag
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
/**
 * De week waarmee het overzicht begint: op een werkdag deze week, in het
 * weekend (za/zo) de kómende werkweek — zodat je niet naar een afgelopen week
 * kijkt maar direct de nieuwe week bovenaan ziet. De afgelopen week valt zo
 * vanzelf weg zodra die voorbij is.
 */
function firstWeekStart(now: Date): Date {
  const m = mondayOf(now);
  const dow = (now.getDay() + 6) % 7; // 0 = maandag … 6 = zondag
  if (dow >= 5) m.setDate(m.getDate() + 7);
  return m;
}
const iso = (d: Date) => d.toLocaleDateString("en-CA");

/** ISO 8601-weeknummer (maandag als eerste dag, week 1 bevat de eerste donderdag). */
function isoWeekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7; // 0 = maandag
  t.setUTCDate(t.getUTCDate() - day + 3); // donderdag van deze week
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDay + 3);
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}
const CONFLICT_THRESHOLD = 4; // opleveringen door dezelfde editor in één week

export async function getPlanningOverview(viewer: Viewer, weeks = 8): Promise<PlanWeek[]> {
  const todayIso = iso(new Date());
  const start = firstWeekStart(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7);
  const startIso = iso(start);
  const endIso = iso(end);

  const [shootRows, deliverableRows, pubRows, leaveRows, meetingRows] = await Promise.all([
    db.select({ id: productionDays.id, date: productionDays.scheduledOn, clientName: clients.name, clientColor: clients.color, clientLogo: clients.logoUrl, person: users.fullName })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .leftJoin(users, eq(users.id, productionDays.videographerId))
      .where(and(isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled"), gte(productionDays.scheduledOn, startIso), lte(productionDays.scheduledOn, endIso), scopeToClients(viewer, productionDays.clientId))),

    db.select({ id: deliverables.id, date: deliverables.dueOn, title: deliverables.title, clientName: clients.name, clientColor: clients.color, clientLogo: clients.logoUrl, person: users.fullName })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(isNull(deliverables.deletedAt), sql`${deliverables.dueOn} is not null`, gte(deliverables.dueOn, startIso), lte(deliverables.dueOn, endIso), sql`${deliverables.status} not in ('published','analysis_available')`, scopeToClients(viewer, deliverables.clientId))),

    db.select({ id: contentCalendar.id, date: contentCalendar.scheduledOn, title: contentCalendar.title, clientName: clients.name, clientColor: clients.color, clientLogo: clients.logoUrl })
      .from(contentCalendar)
      .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
      .where(and(isNull(contentCalendar.deletedAt), gte(contentCalendar.scheduledOn, startIso), lte(contentCalendar.scheduledOn, endIso), scopeToClients(viewer, contentCalendar.clientId))),

    db.select({ name: users.fullName, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .where(and(eq(leaveRequests.status, "approved"), gte(leaveRequests.endOn, startIso), lte(leaveRequests.startOn, endIso))),

    db.select({ id: teamMeetings.id, title: teamMeetings.title, scheduledAt: teamMeetings.scheduledAt, location: teamMeetings.location })
      .from(teamMeetings)
      .where(and(gte(teamMeetings.scheduledAt, start), lte(teamMeetings.scheduledAt, end))),
  ]);

  // Meetings voorbewerken: datum (voor week-bucketing) + tijd.
  const meetings = meetingRows.map((m) => {
    const when = new Date(m.scheduledAt);
    return { id: m.id, title: m.title, date: iso(when), time: when.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }), location: m.location };
  });

  const result: PlanWeek[] = [];
  for (let w = 0; w < weeks; w++) {
    const wStart = new Date(start); wStart.setDate(wStart.getDate() + w * 7);
    const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + 6);
    const s = iso(wStart), e = iso(wEnd);
    const inWeek = (d: string | null) => Boolean(d && d >= s && d <= e);

    const opnames: PlanItem[] = shootRows.filter((r) => inWeek(r.date)).map((r) => ({ id: r.id, kind: "opname", date: r.date, clientName: r.clientName, clientColor: r.clientColor, clientLogo: r.clientLogo, title: "Opname", person: r.person, href: `/productions/${r.id}` }));
    const opleveringen: PlanItem[] = deliverableRows.filter((r) => inWeek(r.date)).map((r) => ({ id: r.id, kind: "oplevering", date: r.date!, clientName: r.clientName, clientColor: r.clientColor, clientLogo: r.clientLogo, title: r.title, person: r.person, href: `/videos/${r.id}` }));
    const publicaties: PlanItem[] = pubRows.filter((r) => inWeek(r.date)).map((r) => ({ id: r.id, kind: "publicatie", date: r.date, clientName: r.clientName, clientColor: r.clientColor, clientLogo: r.clientLogo, title: r.title, person: null, href: `/calendar` }));

    // Conflict: editor met te veel opleveringen in deze week.
    const byEditor = new Map<string, number>();
    for (const o of opleveringen) if (o.person) byEditor.set(o.person, (byEditor.get(o.person) ?? 0) + 1);
    const conflicts = [...byEditor.entries()].filter(([, n]) => n >= CONFLICT_THRESHOLD).map(([editor, count]) => ({ editor, count }));

    const leave = leaveRows.filter((l) => l.startOn <= e && l.endOn >= s).map((l) => ({ name: l.name, startOn: l.startOn, endOn: l.endOn }));
    const weekMeetings = meetings.filter((m) => inWeek(m.date));

    const label = wStart.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) + " – " + wEnd.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    const leadLabel = w === 0 ? (s <= todayIso && todayIso <= e ? `Deze week · ${label}` : `Komende week · ${label}`) : label;
    result.push({ key: s, label: leadLabel, weekNumber: isoWeekNumber(wStart), startOn: s, endOn: e, opnames, opleveringen, publicaties, meetings: weekMeetings, conflicts, leave });
  }
  return result;
}

/** Klanten + medewerkers voor de filters. */
export async function planningFilterOptions(viewer: Viewer) {
  const scope = viewer.clientScope;
  const clientRows = scope === null
    ? await db.select({ name: clients.name }).from(clients).where(and(eq(clients.status, "active"), isNull(clients.deletedAt))).orderBy(clients.name)
    : scope.length === 0 ? [] : await db.select({ name: clients.name }).from(clients).where(and(inArray(clients.id, scope), isNull(clients.deletedAt))).orderBy(clients.name);
  return { clients: clientRows.map((c) => c.name) };
}
