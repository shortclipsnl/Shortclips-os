import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { isMeetingAppointment } from "@/server/integrations/calendar-matching";
import type { CalendarEvent } from "@/server/integrations/google-calendar";
import type { CalendarSource } from "@/server/jobs/calendar-sync";
import type { Viewer } from "@/server/auth/context";

const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("isMeetingAppointment (puur)", () => {
  const ev = (p: Partial<CalendarEvent>): CalendarEvent => ({ id: "x", ...p });

  it("herkent een paarse afspraak (Grape colorId 3) als meeting", () => {
    expect(isMeetingAppointment(ev({ summary: "Afspraak X", colorId: "3" }))).toBe(true);
  });
  it("herkent lichtpaars (Lavender colorId 1) als meeting", () => {
    expect(isMeetingAppointment(ev({ summary: "Afspraak X", colorId: "1" }))).toBe(true);
  });
  it("herkent een Google Meet-link als meeting", () => {
    expect(isMeetingAppointment(ev({ summary: "Iets", hangoutLink: "https://meet.google.com/abc" }))).toBe(true);
  });
  it("herkent trefwoorden (online meeting / klantafspraak / locatie)", () => {
    expect(isMeetingAppointment(ev({ summary: "Online meeting nieuwe lead" }))).toBe(true);
    expect(isMeetingAppointment(ev({ summary: "Kennismaking op locatie" }))).toBe(true);
    expect(isMeetingAppointment(ev({ summary: "Informatiemeeting" }))).toBe(true);
  });
  it("is geen meeting bij een gewone kleur zonder trefwoord", () => {
    expect(isMeetingAppointment(ev({ summary: "Materiaal klaarzetten", colorId: "5" }))).toBe(false);
  });
});

const EVENTS: CalendarEvent[] = [
  // Paarse klantmeeting met Meet-link → meeting, gekoppeld aan SHADES.
  {
    id: "pm1", summary: "Shortclips x SHADES kennismaking", colorId: "3",
    start: { dateTime: soon(8) }, end: { dateTime: soon(8) },
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    attendees: [{ email: "thomas@buildingsgroup.nl", displayName: "Thomas Malolepszy" }, { email: "info@shortclips.nl" }],
    status: "confirmed",
  },
  // Online meeting met een lead (geen klant) → meeting, clientId null.
  {
    id: "pm2", summary: "Online meeting nieuwe lead",
    start: { dateTime: soon(9) }, end: { dateTime: soon(9) },
    hangoutLink: "https://meet.google.com/zzz-zzzz-zzz",
    attendees: [{ email: "lead@prospect.nl", displayName: "Lead Prospect" }],
    status: "confirmed",
  },
  // Paarse opname → blijft opname (titel wint van kleur).
  {
    id: "op1", summary: "3 Shorts Auto Christiaan", colorId: "3",
    start: { dateTime: soon(10) }, end: { dateTime: new Date(Date.now() + 10 * 86_400_000 + 3 * 3_600_000).toISOString() },
    status: "confirmed",
  },
];

const fakeSource: CalendarSource = {
  isConfigured: true,
  configuredCalendarIds: [],
  async listCalendars() { return [{ id: "cal1", summary: "Shortclips afspraken agenda" }]; },
  async listEvents() { return EVENTS; },
};

describe("Google Agenda-meetings in de Weekplanning", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let sync: typeof import("@/server/jobs/calendar-sync");
  let planning: typeof import("@/server/planning-overview");

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    sync = await import("@/server/jobs/calendar-sync");
    planning = await import("@/server/planning-overview");

    const [shades] = await db.insert(s.clients).values({ slug: "buildings-group", name: "BUILDINGS Group" }).returning({ id: s.clients.id });
    await db.insert(s.clientContacts).values({ clientId: shades!.id, fullName: "Thomas Malolepszy", email: "thomas@buildingsgroup.nl" });
    await db.insert(s.clientIntegrations).values({ clientId: shades!.id, provider: "google_calendar", externalId: "shades", config: { aliases: ["SHADES"] } });
  });
  afterAll(async () => { await closeDatabase(); });

  it("classificeert paarse/online afspraken als meeting en laat opnames opname", async () => {
    const res = await sync.runCalendarSync({ source: fakeSource });
    expect(res.ok).toBe(true);

    const rows = await db.select().from(s.calendarEvents);
    const pm1 = rows.find((r) => r.externalId === "pm1")!;
    expect(pm1.kind).toBe("meeting");
    expect(pm1.meetLink).toContain("meet.google.com");
    expect(pm1.colorId).toBe("3");

    const pm2 = rows.find((r) => r.externalId === "pm2")!;
    expect(pm2.kind).toBe("meeting");
    expect(pm2.clientId).toBeNull();

    const op1 = rows.find((r) => r.externalId === "op1")!;
    expect(op1.kind).toBe("opname");
  });

  it("toont de Google-meetings in de productieplanning (met Meet-link en deelnemers)", async () => {
    const viewer = { clientScope: null } as unknown as Viewer;
    const weeks = await planning.getPlanningOverview(viewer, 12);
    const meetings = weeks.flatMap((w) => w.meetings);

    const pm1 = meetings.find((m) => m.title.includes("SHADES kennismaking"));
    expect(pm1, "paarse klantmeeting staat in de planning").toBeTruthy();
    expect(pm1!.source).toBe("google");
    expect(pm1!.meetLink).toContain("meet.google.com");
    expect(pm1!.attendees.join(" ")).toContain("Thomas");
    expect(pm1!.clientName).toBe("BUILDINGS Group");

    expect(meetings.some((m) => m.title.includes("Online meeting nieuwe lead"))).toBe(true);
    // De opname hoort NIET bij de meetings.
    expect(meetings.some((m) => m.title.includes("Auto Christiaan"))).toBe(false);
  });
});
