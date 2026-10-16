import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import type { CalendarSource } from "@/server/jobs/calendar-sync";
import type { CalendarEvent } from "@/server/integrations/google-calendar";

/**
 * Annuleringen (audit): een afspraak die uit Google verdwijnt (geannuleerd of
 * verwijderd) moet in de Hub als geannuleerd worden gemarkeerd, en de daarvan
 * afgeleide opnamedag moet ook op geannuleerd komen.
 */
function shoot(): CalendarEvent {
  return {
    id: "evt-1",
    summary: "Shortclips x SHADES monthly shootday",
    start: { dateTime: new Date(Date.now() + 10 * 86_400_000).toISOString() },
    end: { dateTime: new Date(Date.now() + 10 * 86_400_000).toISOString() },
    attendees: [{ email: "thomas@buildingsgroup.nl" }],
    status: "confirmed",
  };
}

describe("Agenda-sync: annuleringen opruimen", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let sync: typeof import("@/server/jobs/calendar-sync");
  let clientId = "";
  let present = true; // of de afspraak nog uit Google komt

  const source: CalendarSource = {
    isConfigured: true,
    configuredCalendarIds: ["cal-a"],
    async listCalendars() {
      return [{ id: "cal-a", summary: "Agenda A" }];
    },
    async listEvents() {
      return present ? [shoot()] : [];
    },
  };

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    sync = await import("@/server/jobs/calendar-sync");
    const [c] = await db.insert(s.clients).values({ slug: "buildings-group", name: "BUILDINGS Group" }).returning({ id: s.clients.id });
    clientId = c!.id;
    await db.insert(s.clientContacts).values({ clientId, fullName: "Thomas", email: "thomas@buildingsgroup.nl" });
    await db.insert(s.clientIntegrations).values({ clientId, provider: "google_calendar", externalId: "shades", config: { aliases: ["SHADES"] } });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("maakt eerst de afspraak + opnamedag aan", async () => {
    await sync.runCalendarSync({ source });
    const [ev] = await db.select().from(s.calendarEvents).where(eq(s.calendarEvents.externalId, "evt-1"));
    expect(ev?.clientId).toBe(clientId);
    const pds = await db.select().from(s.productionDays).where(eq(s.productionDays.clientId, clientId));
    expect(pds.length).toBe(1);
    expect(pds[0]!.status).not.toBe("cancelled");
  });

  it("annuleert afspraak én opnamedag als de afspraak uit Google verdwijnt", async () => {
    present = false;
    await sync.runCalendarSync({ source });
    const [ev] = await db.select().from(s.calendarEvents).where(eq(s.calendarEvents.externalId, "evt-1"));
    expect(ev?.status).toBe("cancelled");
    const pds = await db.select().from(s.productionDays).where(eq(s.productionDays.clientId, clientId));
    expect(pds[0]!.status).toBe("cancelled");
  });
});
