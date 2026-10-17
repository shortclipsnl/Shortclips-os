import "server-only";
import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCalendar, deliverables, leaveRequests, productionDays, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";

/**
 * Productieoverzicht voor de komende N weken (Deel 4): opnames, opleveringen
 * (deadlines) en publicaties per week gebucket, plus verlof en een eenvoudige
 * conflictsignalering (editor met veel opleveringen in één week). Alles klant-
 * gescoopt; puur lezen uit bestaande tabellen.
 */

export type PlanItem = { id: string; kind: "opname" | "oplevering" | "publicatie"; date: string; clientName: string; clientColor: string | null; title: string; person: string | null; href: string };
export type PlanWeek = {
  key: string; label: string; startOn: string; endOn: string;
  opnames: PlanItem[]; opleveringen: PlanItem[]; publicaties: PlanItem[];
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
const iso = (d: Date) => d.toLocaleDateString("en-CA");
const CONFLICT_THRESHOLD = 4; // opleveringen door dezelfde editor in één week

export async function getPlanningOverview(viewer: Viewer, weeks = 8): Promise<PlanWeek[]> {
  const start = mondayOf(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7);
  const startIso = iso(start);
  const endIso = iso(end);

  const [shootRows, deliverableRows, pubRows, leaveRows] = await Promise.all([
    db.select({ id: productionDays.id, date: productionDays.scheduledOn, clientName: clients.name, clientColor: clients.color, person: users.fullName })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .leftJoin(users, eq(users.id, productionDays.videographerId))
      .where(and(isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled"), gte(productionDays.scheduledOn, startIso), lte(productionDays.scheduledOn, endIso), scopeToClients(viewer, productionDays.clientId))),

    db.select({ id: deliverables.id, date: deliverables.dueOn, title: deliverables.title, clientName: clients.name, clientColor: clients.color, person: users.fullName })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(isNull(deliverables.deletedAt), sql`${deliverables.dueOn} is not null`, gte(deliverables.dueOn, startIso), lte(deliverables.dueOn, endIso), sql`${deliverables.status} not in ('published','analysis_available')`, scopeToClients(viewer, deliverables.clientId))),

    db.select({ id: contentCalendar.id, date: contentCalendar.scheduledOn, title: contentCalendar.title, clientName: clients.name, clientColor: clients.color })
      .from(contentCalendar)
      .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
      .where(and(isNull(contentCalendar.deletedAt), gte(contentCalendar.scheduledOn, startIso), lte(contentCalendar.scheduledOn, endIso), scopeToClients(viewer, contentCalendar.clientId))),

    db.select({ name: users.fullName, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .where(and(eq(leaveRequests.status, "approved"), gte(leaveRequests.endOn, startIso), lte(leaveRequests.startOn, endIso))),
  ]);

  const result: PlanWeek[] = [];
  for (let w = 0; w < weeks; w++) {
    const wStart = new Date(start); wStart.setDate(wStart.getDate() + w * 7);
    const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + 6);
    const s = iso(wStart), e = iso(wEnd);
    const inWeek = (d: string | null) => Boolean(d && d >= s && d <= e);

    const opnames: PlanItem[] = shootRows.filter((r) => inWeek(r.date)).map((r) => ({ id: r.id, kind: "opname", date: r.date, clientName: r.clientName, clientColor: r.clientColor, title: "Opname", person: r.person, href: `/productions/${r.id}` }));
    const opleveringen: PlanItem[] = deliverableRows.filter((r) => inWeek(r.date)).map((r) => ({ id: r.id, kind: "oplevering", date: r.date!, clientName: r.clientName, clientColor: r.clientColor, title: r.title, person: r.person, href: `/videos/${r.id}` }));
    const publicaties: PlanItem[] = pubRows.filter((r) => inWeek(r.date)).map((r) => ({ id: r.id, kind: "publicatie", date: r.date, clientName: r.clientName, clientColor: r.clientColor, title: r.title, person: null, href: `/calendar` }));

    // Conflict: editor met te veel opleveringen in deze week.
    const byEditor = new Map<string, number>();
    for (const o of opleveringen) if (o.person) byEditor.set(o.person, (byEditor.get(o.person) ?? 0) + 1);
    const conflicts = [...byEditor.entries()].filter(([, n]) => n >= CONFLICT_THRESHOLD).map(([editor, count]) => ({ editor, count }));

    const leave = leaveRows.filter((l) => l.startOn <= e && l.endOn >= s).map((l) => ({ name: l.name, startOn: l.startOn, endOn: l.endOn }));

    const label = wStart.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) + " – " + wEnd.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    result.push({ key: s, label: w === 0 ? `Deze week · ${label}` : label, startOn: s, endOn: e, opnames, opleveringen, publicaties, conflicts, leave });
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
