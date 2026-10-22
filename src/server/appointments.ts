import "server-only";
import { and, asc, eq, gte, isNull, lte, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { calendarEvents, clients } from "@/db/schema";

export type Appointment = typeof calendarEvents.$inferSelect;

export type ScriptAppointment = {
  id: string;
  title: string | null;
  startsAt: Date;
  allDay: boolean;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
};

/**
 * Aankomende script-afspraken uit de agenda (klantgekoppeld), t/m eind dit jaar.
 * Voor de Scripting-pagina: zo ziet het team welke scriptbesprekingen eraan komen.
 */
export async function upcomingScriptAppointments(limit = 40): Promise<ScriptAppointment[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endOfYear = new Date(today.getFullYear(), 11, 31, 23, 59);
  return db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      startsAt: calendarEvents.startsAt,
      allDay: calendarEvents.allDay,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
    })
    .from(calendarEvents)
    .innerJoin(clients, eq(clients.id, calendarEvents.clientId))
    .where(
      and(
        eq(calendarEvents.kind, "scriptbespreking"),
        gte(calendarEvents.startsAt, today),
        lte(calendarEvents.startsAt, endOfYear),
        or(isNull(calendarEvents.status), ne(calendarEvents.status, "cancelled")),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(limit);
}

/** Komende afspraken van één klant (voor het portaal en de klantpagina). */
export async function upcomingAppointmentsForClient(
  clientId: string,
  limit = 6,
): Promise<Appointment[]> {
  return db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.clientId, clientId),
        gte(calendarEvents.startsAt, new Date()),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(limit);
}

/** Eerstvolgende opnamedag van één klant, of null. */
export async function nextShootForClient(clientId: string): Promise<Appointment | null> {
  const [row] = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.clientId, clientId),
        eq(calendarEvents.kind, "opname"),
        gte(calendarEvents.startsAt, new Date()),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(1);
  return row ?? null;
}

export type UnmatchedAppointment = Appointment;

/**
 * Afspraken zonder (zekere) klant — voor de review in het beheer. Dit is waar
 * de founder-eis "voorkom dat verkeerde info stilletjes bij de verkeerde klant
 * komt" zichtbaar wordt: twijfelgevallen staan hier, niet in een klantomgeving.
 */
export async function unmatchedAppointments(limit = 100): Promise<UnmatchedAppointment[]> {
  const since = new Date(Date.now() - 7 * 86_400_000);
  return db
    .select()
    .from(calendarEvents)
    .where(
      and(
        isNull(calendarEvents.clientId),
        ne(calendarEvents.kind, "intern"),
        gte(calendarEvents.startsAt, since),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(limit);
}

/** Telt gekoppeld vs. te controleren, voor de koppelingen-/statuspagina. */
export async function appointmentReviewStats(): Promise<{
  total: number;
  matched: number;
  needsReview: number;
  ambiguous: number;
  internal: number;
  lastSyncedAt: Date | null;
}> {
  const rows = await db
    .select({
      clientId: calendarEvents.clientId,
      confidence: calendarEvents.matchConfidence,
      kind: calendarEvents.kind,
      syncedAt: calendarEvents.syncedAt,
    })
    .from(calendarEvents);

  let matched = 0;
  let needsReview = 0;
  let ambiguous = 0;
  let internal = 0;
  let lastSyncedAt: Date | null = null;
  for (const r of rows) {
    if (r.clientId) matched++;
    else if (r.kind === "intern") internal++;
    else needsReview++;
    if (!r.clientId && r.confidence === "ambiguous") ambiguous++;
    if (r.syncedAt && (!lastSyncedAt || r.syncedAt > lastSyncedAt)) lastSyncedAt = r.syncedAt;
  }
  return { total: rows.length, matched, needsReview, ambiguous, internal, lastSyncedAt };
}

/** Naam van een klant opzoeken (voor review-weergave). */
export async function clientNamesByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: clients.id, name: clients.name }).from(clients);
  const map = new Map<string, string>();
  for (const r of rows) if (ids.includes(r.id)) map.set(r.id, r.name);
  return map;
}
