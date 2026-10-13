import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import type { CalendarSource } from "@/server/jobs/calendar-sync";
import type { CalendarEvent } from "@/server/integrations/google-calendar";

/**
 * Ontdubbelen (#4): dezelfde opname kan in meerdere gekoppelde agenda's staan
 * (bijv. een gedeelde afspraak). De sync moet er dan één opnamedag van maken,
 * niet twee — anders zie je dubbele opnames in de opnameplanning.
 */

// Dezelfde opname (zelfde klant, datum en titel) in twee verschillende agenda's,
// met per agenda een eigen event-id.
function shoot(id: string): CalendarEvent {
  return {
    id,
    summary: "Shortclips x SHADES monthly shootday",
    start: { date: "2026-12-10" },
    end: { date: "2026-12-11" },
    attendees: [{ email: "thomas@buildingsgroup.nl" }],
    status: "confirmed",
  };
}

const twoCalendarSource: CalendarSource = {
  isConfigured: true,
  configuredCalendarIds: ["cal-a", "cal-b"],
  async listCalendars() {
    return [
      { id: "cal-a", summary: "Agenda A" },
      { id: "cal-b", summary: "Agenda B" },
    ];
  },
  async listEvents(calendarId: string) {
    // Zelfde opname in beide agenda's, maar met een eigen event-id per agenda.
    return [shoot(calendarId === "cal-a" ? "a1" : "b1")];
  },
};

describe("Agenda-synchronisatie: ontdubbelen over meerdere agenda's", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let sync: typeof import("@/server/jobs/calendar-sync");
  let clientId = "";

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    sync = await import("@/server/jobs/calendar-sync");

    const [c] = await db
      .insert(s.clients)
      .values({ slug: "buildings-group", name: "BUILDINGS Group" })
      .returning({ id: s.clients.id });
    clientId = c!.id;
    await db.insert(s.clientContacts).values({
      clientId,
      fullName: "Thomas Malolepszy",
      email: "thomas@buildingsgroup.nl",
    });
    await db.insert(s.clientIntegrations).values({
      clientId,
      provider: "google_calendar",
      externalId: "shades",
      config: { aliases: ["SHADES"] },
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("maakt van dezelfde opname in twee agenda's één opnamedag", async () => {
    const result = await sync.runCalendarSync({ source: twoCalendarSource });
    expect(result.ok).toBe(true);

    // De ruwe afspraken blijven per agenda bestaan (twee rijen).
    const events = await db.select().from(s.calendarEvents);
    expect(events.length).toBe(2);
    expect(events.every((e) => e.clientId === clientId)).toBe(true);

    // Maar er is precies één opnamedag afgeleid.
    const pds = await db.select().from(s.productionDays).where(eq(s.productionDays.clientId, clientId));
    expect(pds.length).toBe(1);

    // Beide agenda-afspraken wijzen naar diezelfde opnamedag.
    const maps = await db
      .select()
      .from(s.mondayMappings)
      .where(eq(s.mondayMappings.entityType, "calendar_shoot"));
    expect(maps.length).toBe(2);
    expect(new Set(maps.map((m) => m.entityId)).size).toBe(1);
    expect(maps[0]!.entityId).toBe(pds[0]!.id);
  });

  it("blijft idempotent: opnieuw draaien houdt één opnamedag", async () => {
    await sync.runCalendarSync({ source: twoCalendarSource });
    const pds = await db.select().from(s.productionDays).where(eq(s.productionDays.clientId, clientId));
    expect(pds.length).toBe(1);
  });
});
