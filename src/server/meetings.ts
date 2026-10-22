import "server-only";
import { and, asc, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMeetings } from "@/db/schema";

export type UpcomingMeeting = {
  id: string;
  title: string;
  scheduledAt: Date;
  location: string | null;
};

/**
 * De eerstvolgende teammeetings binnen een venster (standaard de komende 14
 * dagen), oplopend op datum. Voor de weekplanning op het dashboard.
 */
export async function listUpcomingMeetings(days = 14, limit = 8): Promise<UpcomingMeeting[]> {
  const now = new Date();
  const until = new Date(now);
  until.setDate(now.getDate() + days);
  // Kleine marge zodat een meeting die nu bezig is nog meetelt.
  const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const rows = await db
    .select({ id: teamMeetings.id, title: teamMeetings.title, scheduledAt: teamMeetings.scheduledAt, location: teamMeetings.location })
    .from(teamMeetings)
    .where(and(gte(teamMeetings.scheduledAt, from), lt(teamMeetings.scheduledAt, until)))
    .orderBy(asc(teamMeetings.scheduledAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, scheduledAt: new Date(r.scheduledAt) }));
}

/** De eerstvolgende woensdag om 16:00 (vandaag als het woensdag is en vóór de avond). */
function nextWednesday16(): Date {
  const d = new Date();
  const day = d.getDay(); // 0=zo … 3=wo … 6=za
  let add = (3 - day + 7) % 7;
  if (add === 0 && d.getHours() >= 18) add = 7; // woensdagavond → volgende week
  const t = new Date(d);
  t.setDate(d.getDate() + add);
  t.setHours(16, 0, 0, 0);
  return t;
}

/**
 * Zorgt dat de eerstvolgende wekelijkse teammeeting (woensdag 16:00) bestaat.
 * De meeting start met een LEGE bespreekpuntenlijst — elke week een schone lei,
 * geen punten van de vorige keer. Geeft het meeting-id terug.
 */
export async function ensureWeeklyMeeting(): Promise<string> {
  const when = nextWednesday16();
  const dayKey = when.toISOString().slice(0, 10);

  // Bestaat er al een (niet-gearchiveerde) wekelijkse meeting op deze woensdag?
  const existing = await db
    .select({ id: teamMeetings.id, scheduledAt: teamMeetings.scheduledAt })
    .from(teamMeetings)
    .where(and(eq(teamMeetings.isWeekly, true), isNull(teamMeetings.archivedAt)))
    .orderBy(desc(teamMeetings.scheduledAt))
    .limit(5);
  const match = existing.find((m) => new Date(m.scheduledAt).toISOString().slice(0, 10) === dayKey);
  if (match) return match.id;

  const [created] = await db
    .insert(teamMeetings)
    .values({ title: "Teammeeting", scheduledAt: when, location: "Kantoor / online", isWeekly: true })
    .returning({ id: teamMeetings.id });
  return created!.id;
}
