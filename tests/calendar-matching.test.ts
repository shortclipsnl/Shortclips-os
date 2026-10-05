import { describe, expect, it } from "vitest";
import {
  classifyAppointment,
  extractTitleHint,
  isInternalEmail,
  matchEvent,
  type ClientMatcher,
} from "@/server/integrations/calendar-matching";
import type { CalendarEvent } from "@/server/integrations/google-calendar";

/**
 * Gebaseerd op een echte afspraak uit de ShortClips-agenda:
 *   titel  "Shortclips x SHADES monthly shootday"
 *   gasten thomas@buildingsgroup.nl (klant) + info@shortclips.nl (intern)
 */

const CLIENTS: ClientMatcher[] = [
  {
    id: "c-shades",
    name: "BUILDINGS Group",
    slug: "buildings-group",
    aliases: ["SHADES"],
    contactEmails: ["don@buildingsgroup.nl"],
    domains: ["buildingsgroup.nl"],
  },
  {
    id: "c-fl",
    name: "Friesland Lease",
    slug: "friesland-lease",
    domains: ["frieslandlease.nl"],
  },
];

function event(summary: string, emails: string[] = []): CalendarEvent {
  return {
    id: "evt",
    summary,
    attendees: emails.map((email) => ({ email })),
  };
}

describe("soort afspraak herkennen", () => {
  it("herkent een opnamedag", () => {
    expect(classifyAppointment("Shortclips x SHADES monthly shootday")).toBe("opname");
    expect(classifyAppointment("Opnamedag Friesland Lease")).toBe("opname");
    expect(classifyAppointment("Draaidag Donkergroen")).toBe("opname");
  });
  it("herkent scriptbespreking, evaluatie en publicatie", () => {
    expect(classifyAppointment("Scriptbespreking met klant")).toBe("scriptbespreking");
    expect(classifyAppointment("Evaluatiegesprek Q3")).toBe("evaluatie");
    expect(classifyAppointment("Video online zetten")).toBe("publicatie");
  });
  it("leidt publicatie af uit de agenda 'Klant Content uploaden'", () => {
    expect(classifyAppointment("Reel 3", "Klant Content uploaden")).toBe("publicatie");
  });
  it("valt terug op 'overig' zonder duidelijke aanwijzing", () => {
    expect(classifyAppointment("Teamoverleg")).toBe("overig");
  });
});

describe("klant-aanduiding uit de titel", () => {
  it("haalt de naam ná 'Shortclips x' eruit", () => {
    expect(extractTitleHint("Shortclips x SHADES monthly shootday")).toBe("SHADES");
    expect(extractTitleHint("Shortclips x Friesland Lease opname")).toBe("Friesland Lease");
  });
  it("geeft niets terug zonder het patroon", () => {
    expect(extractTitleHint("Teamoverleg")).toBeNull();
  });
});

describe("intern versus extern e-mailadres", () => {
  it("herkent interne adressen", () => {
    expect(isInternalEmail("info@shortclips.nl")).toBe(true);
    expect(isInternalEmail("teamshortclips@gmail.com")).toBe(true);
    expect(isInternalEmail("iemand@shortclips.nl")).toBe(true);
    expect(isInternalEmail(undefined)).toBe(true);
  });
  it("herkent klantadressen als extern", () => {
    expect(isInternalEmail("thomas@buildingsgroup.nl")).toBe(false);
  });
});

describe("afspraak aan de juiste klant koppelen", () => {
  it("koppelt de echte SHADES-opnamedag met hoge zekerheid (titel + domein)", () => {
    const result = matchEvent(
      event("Shortclips x SHADES monthly shootday", [
        "thomas@buildingsgroup.nl",
        "info@shortclips.nl",
        "teamshortclips@gmail.com",
      ]),
      CLIENTS,
    );
    expect(result.clientId).toBe("c-shades");
    expect(result.confidence).toBe("high");
    expect(result.matchedBy).toContain("domein:buildingsgroup.nl");
    expect(result.matchedBy).toContain("titel:SHADES");
  });

  it("koppelt op titel alleen met medium zekerheid", () => {
    const result = matchEvent(event("Shortclips x Friesland Lease opname"), CLIENTS);
    expect(result.clientId).toBe("c-fl");
    expect(result.confidence).toBe("medium");
  });

  it("gokt NIET bij alleen interne deelnemers en geen klant in de titel", () => {
    const result = matchEvent(event("Teamoverleg maandag", ["info@shortclips.nl"]), CLIENTS);
    expect(result.clientId).toBeNull();
    expect(result.confidence).toBe("none");
  });

  it("markeert als ambigu wanneer meerdere klanten passen", () => {
    const ambigu: ClientMatcher[] = [
      { id: "a", name: "Donkergroen", slug: "donkergroen" },
      { id: "b", name: "Groenbeheer Noord", slug: "groenbeheer-noord" },
    ];
    const result = matchEvent(event("Shortclips x Groen opname"), ambigu);
    expect(result.clientId).toBeNull();
    expect(result.confidence).toBe("ambiguous");
    expect(result.candidates.length).toBe(2);
  });
});
