import "server-only";
import { and, asc, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { meetingItems, teamMeetings } from "@/db/schema";
import { aiConfigured, runPrompt } from "@/server/ai/client";

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

/**
 * Maakt een korte samenvatting van de besproken punten van een meeting. Met de
 * AI-sleutel een bondige samenvatting; anders een nette opsomming van de punten.
 * Geeft null terug als er niets te vatten valt.
 */
export async function buildMeetingSummary(meetingId: string): Promise<string | null> {
  const items = await db
    .select({ kind: meetingItems.kind, body: meetingItems.body })
    .from(meetingItems)
    .where(eq(meetingItems.meetingId, meetingId))
    .orderBy(asc(meetingItems.sortOrder), asc(meetingItems.createdAt));
  const pts = items.filter((i) => i.body && i.body.trim());
  if (pts.length === 0) return null;

  const bullets = pts
    .map((i) => `- ${i.kind === "decision" ? "Besluit: " : i.kind === "action" ? "Actie: " : ""}${i.body.trim()}`)
    .join("\n");
  if (!aiConfigured()) return bullets;

  const res = await runPrompt({
    system: "Je vat een interne teammeeting van ShortClips bondig samen in het Nederlands. Noem de kernthema's, besluiten en actiepunten in korte bullets. Geen inleiding, geen verzinsels.",
    user: `Besproken punten:\n${bullets}\n\nGeef een korte samenvatting (max ~8 bullets).`,
    maxTokens: 800,
  });
  return res.ok && res.text.trim() ? res.text.trim() : bullets;
}

/** Hoe ver Europe/Amsterdam vóór UTC ligt op een moment, in ms (DST-proof). */
function amsterdamOffsetMs(at: Date): number {
  const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const ams = new Date(at.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  return ams.getTime() - utc.getTime();
}

/** Het UTC-moment dat in Amsterdam exact die wandklok-tijd is (bv. 16:00). */
function amsterdamWallToUtc(y: number, mon: number, day: number, hour: number): Date {
  const guess = Date.UTC(y, mon, day, hour, 0, 0);
  return new Date(guess - amsterdamOffsetMs(new Date(guess)));
}

/**
 * De eerstvolgende woensdag om 16:00 Nederlandse tijd (vandaag als het woensdag is
 * en vóór de avond). Onafhankelijk van de serverzone (Vercel draait op UTC), zodat
 * de meeting overal als 16:00 wordt getoond.
 */
function nextWednesday16(): Date {
  // "Nu" als Amsterdamse wandklok (de kalendervelden kloppen dan met NL).
  const ams = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  const day = ams.getDay(); // 0=zo … 3=wo … 6=za
  let add = (3 - day + 7) % 7;
  if (add === 0 && ams.getHours() >= 18) add = 7; // woensdagavond → volgende week
  ams.setDate(ams.getDate() + add);
  return amsterdamWallToUtc(ams.getFullYear(), ams.getMonth(), ams.getDate(), 16);
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
