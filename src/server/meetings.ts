import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { meetingItems, teamMeetings } from "@/db/schema";

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
 * Zorgt dat de vaste wekelijkse teammeeting (woensdag 16:00) bestaat. Bij het
 * aanmaken worden de niet-behandelde bespreekpunten van de vorige wekelijkse
 * meeting automatisch meegenomen (carry-over). Geeft het meeting-id terug.
 */
export async function ensureWeeklyMeeting(): Promise<string> {
  const when = nextWednesday16();
  const dayKey = when.toISOString().slice(0, 10);

  // Bestaat er al een wekelijkse meeting op deze woensdag?
  const existing = await db
    .select({ id: teamMeetings.id, scheduledAt: teamMeetings.scheduledAt })
    .from(teamMeetings)
    .where(eq(teamMeetings.isWeekly, true))
    .orderBy(desc(teamMeetings.scheduledAt))
    .limit(5);
  const match = existing.find((m) => new Date(m.scheduledAt).toISOString().slice(0, 10) === dayKey);
  if (match) return match.id;

  const [created] = await db
    .insert(teamMeetings)
    .values({ title: "Teammeeting", scheduledAt: when, location: "Kantoor / online", isWeekly: true })
    .returning({ id: teamMeetings.id });
  const newId = created!.id;

  // Carry-over: niet-behandelde bespreekpunten van de meest recente vorige
  // wekelijkse meeting overnemen.
  const [prev] = await db
    .select({ id: teamMeetings.id })
    .from(teamMeetings)
    .where(and(eq(teamMeetings.isWeekly, true), lt(teamMeetings.scheduledAt, when)))
    .orderBy(desc(teamMeetings.scheduledAt))
    .limit(1);
  if (prev) {
    const carry = await db
      .select({ body: meetingItems.body, createdById: meetingItems.createdById })
      .from(meetingItems)
      .where(and(eq(meetingItems.meetingId, prev.id), eq(meetingItems.kind, "agenda"), eq(meetingItems.isDone, false)));
    if (carry.length > 0) {
      await db.insert(meetingItems).values(
        carry.map((c) => ({ meetingId: newId, kind: "agenda" as const, body: c.body, createdById: c.createdById })),
      );
    }
  }

  return newId;
}
