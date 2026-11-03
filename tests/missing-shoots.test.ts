import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { missingShootAppointments } from "@/server/appointments";

/**
 * De Opnameplanning toont opnames uit Google Agenda die (nog) niet gekoppeld
 * zijn, zodat er niets stilletjes verdwijnt. Deze test bewijst de selectie:
 * herkende opnames zonder klant verschijnen, gewone meetings niet, en al
 * gekoppelde opnames evenmin.
 */
const soon = (days: number) => new Date(Date.now() + days * 86_400_000);

describe("missingShootAppointments", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let clientId = "";

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    const [c] = await db.insert(s.clients).values({ slug: "alfa", name: "Alfa" }).returning({ id: s.clients.id });
    clientId = c!.id;

    const base = { source: "google_calendar", calendarId: "cal1", calendarName: "Agenda Jarno" } as const;
    await db.insert(s.calendarEvents).values([
      // 1. Opname herkend, geen klant → MOET verschijnen.
      { ...base, externalId: "m1", kind: "opname", clientId: null, title: "Opnamedag nieuwe klant", startsAt: soon(5), status: "confirmed", matchConfidence: "none" },
      // 2. "overig" met aantal shorts + externe gast → mogelijk gemist → MOET verschijnen.
      { ...base, externalId: "m2", kind: "overig", clientId: null, title: "6 shorts voor prospect", startsAt: soon(6), status: "confirmed", matchConfidence: "none", attendees: [{ email: "lead@prospect.nl" }] },
      // 3. Gewone meeting (geen shorts) → MAG NIET verschijnen.
      { ...base, externalId: "m3", kind: "meeting", clientId: null, title: "Online meeting met lead", startsAt: soon(7), status: "confirmed", matchConfidence: "none", attendees: [{ email: "lead@prospect.nl" }] },
      // 4. Opname mét klant (al in de planning) → MAG NIET verschijnen.
      { ...base, externalId: "m4", kind: "opname", clientId, title: "Opnamedag Alfa", startsAt: soon(8), status: "confirmed", matchConfidence: "high" },
      // 5. Geannuleerde opname zonder klant → MAG NIET verschijnen.
      { ...base, externalId: "m5", kind: "opname", clientId: null, title: "Afgezegde opname", startsAt: soon(9), status: "cancelled", matchConfidence: "none" },
      // 6. "overig" met shorts maar alleen interne gasten → MAG NIET (geen externe).
      { ...base, externalId: "m6", kind: "overig", clientId: null, title: "4 shorts intern bespreken", startsAt: soon(10), status: "confirmed", matchConfidence: "none", attendees: [{ email: "jarno@shortclips.nl" }] },
      // 7. Beschikbaarheidsmarkering met het woord "opname" in de titel, als opname
      //    geclassificeerd, geen externe gast → MAG NIET (geen opnamedag).
      { ...base, externalId: "m7", kind: "opname", clientId: null, title: "Beschikbaar voor opnames", startsAt: soon(11), status: "confirmed", matchConfidence: "none" },
      // 8. Kantoor-/beschikbaarheidsnotitie → MAG NIET.
      { ...base, externalId: "m8", kind: "opname", clientId: null, title: "SHORTCLIPS OPEN, ALLEEN KANTOORWERK > INDIEN KAN EEN OPNAME", startsAt: soon(12), status: "confirmed", matchConfidence: "none" },
      // 9. Opname herkend zonder klant, maar handmatig weggegooid (prullenbak) → MAG NIET.
      { ...base, externalId: "m9", kind: "opname", clientId: null, title: "Opnamedag weggegooid", startsAt: soon(13), status: "confirmed", matchConfidence: "none", dismissedAt: new Date() },
    ]);
  });
  afterAll(async () => { await closeDatabase(); });

  it("toont herkende opnames zonder klant en mogelijk gemiste opnames, maar geen gewone meetings, gekoppelde opnames, beschikbaarheidsmarkeringen of weggegooide afspraken", async () => {
    const rows = await missingShootAppointments(50);
    const ids = rows.map((r) => r.externalId).sort();
    expect(ids).toEqual(["m1", "m2"]);
  });
});
