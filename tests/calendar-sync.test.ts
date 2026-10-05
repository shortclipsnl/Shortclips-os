import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import type { CalendarSource } from "@/server/jobs/calendar-sync";
import type { CalendarEvent } from "@/server/integrations/google-calendar";

/**
 * Draait de echte sync-logica (matchen + opslaan + flaggen) tegen een echte
 * test-database, met een NEPBRON die vaste afspraken teruggeeft. Zo is de hele
 * keten te bewijzen zonder Google-credentials of internet.
 *
 * De afspraken zijn gemodelleerd op het echte patroon in de ShortClips-agenda.
 */

const soon = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

const EVENTS: CalendarEvent[] = [
  {
    id: "e1",
    summary: "Shortclips x SHADES monthly shootday",
    start: { date: "2026-12-10" },
    end: { date: "2026-12-11" },
    attendees: [
      { email: "thomas@buildingsgroup.nl" },
      { email: "info@shortclips.nl" },
      { email: "teamshortclips@gmail.com" },
    ],
    status: "confirmed",
  },
  {
    id: "e2",
    summary: "Overleg met leverancier",
    start: { dateTime: soon(5) },
    end: { dateTime: soon(5) },
    attendees: [{ email: "verkoop@randomsupplier.com" }],
    status: "confirmed",
  },
  {
    id: "e3",
    summary: "Shortclips x Friesland Lease opname",
    start: { dateTime: soon(12) },
    end: { dateTime: soon(12) },
    status: "confirmed",
  },
];

const fakeSource: CalendarSource = {
  isConfigured: true,
  configuredCalendarIds: [],
  async listCalendars() {
    return [{ id: "cal1", summary: "Shortclips afspraken agenda" }];
  },
  async listEvents() {
    return EVENTS;
  },
};

describe("Google Agenda synchronisatie", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let sync: typeof import("@/server/jobs/calendar-sync");
  let appts: typeof import("@/server/appointments");
  const id = { shades: "", fl: "" };

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    sync = await import("@/server/jobs/calendar-sync");
    appts = await import("@/server/appointments");

    const [shades] = await db
      .insert(s.clients)
      .values({ slug: "buildings-group", name: "BUILDINGS Group" })
      .returning({ id: s.clients.id });
    const [fl] = await db
      .insert(s.clients)
      .values({ slug: "friesland-lease", name: "Friesland Lease" })
      .returning({ id: s.clients.id });
    id.shades = shades!.id;
    id.fl = fl!.id;

    // Contact met klantdomein → sterk matchsignaal voor SHADES.
    await db.insert(s.clientContacts).values({
      clientId: id.shades,
      fullName: "Thomas Malolepszy",
      email: "thomas@buildingsgroup.nl",
    });
    // Merk-alias "SHADES" via de koppelingsconfiguratie.
    await db.insert(s.clientIntegrations).values({
      clientId: id.shades,
      provider: "google_calendar",
      externalId: "shades",
      config: { aliases: ["SHADES"] },
    });
    // Friesland Lease: geen contact/domein → alleen titelmatch mogelijk.
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("koppelt, classificeert en flaggt afspraken correct", async () => {
    const result = await sync.runCalendarSync({ source: fakeSource });
    expect(result.ok).toBe(true);

    const rows = await db.select().from(s.calendarEvents);
    expect(rows.length).toBe(3);

    const e1 = rows.find((r) => r.externalId === "e1")!;
    expect(e1.clientId).toBe(id.shades);
    expect(e1.kind).toBe("opname");
    expect(e1.matchConfidence).toBe("high");
    expect(e1.allDay).toBe(true);

    const e2 = rows.find((r) => r.externalId === "e2")!;
    expect(e2.clientId).toBeNull();
    expect(e2.matchConfidence).toBe("none");

    const e3 = rows.find((r) => r.externalId === "e3")!;
    expect(e3.clientId).toBe(id.fl);
    expect(e3.kind).toBe("opname");
    expect(e3.matchConfidence).toBe("medium");
  });

  it("is idempotent: opnieuw draaien dupliceert niet", async () => {
    await sync.runCalendarSync({ source: fakeSource });
    const rows = await db.select().from(s.calendarEvents);
    expect(rows.length).toBe(3);
  });

  it("toont de eerstvolgende opname van een klant in het portaal", async () => {
    const next = await appts.nextShootForClient(id.shades);
    expect(next?.externalId).toBe("e1");
    const upcoming = await appts.upcomingAppointmentsForClient(id.shades);
    expect(upcoming.some((a) => a.externalId === "e1")).toBe(true);
  });

  it("zet twijfelgevallen in de review, niet bij een klant", async () => {
    const review = await appts.unmatchedAppointments();
    expect(review.some((a) => a.externalId === "e2")).toBe(true);
    expect(review.some((a) => a.clientId !== null)).toBe(false);
  });
});
