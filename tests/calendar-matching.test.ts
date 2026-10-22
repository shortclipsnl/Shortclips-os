import { describe, expect, it } from "vitest";
import {
  classifyAppointment,
  extractTitleHint,
  isInternalAppointment,
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
  it("herkent het meervoud 'scripts' als scriptbespreking (was eerder 'overig')", () => {
    expect(classifyAppointment("Autochristiaan scripts in bestand - 9 november")).toBe("scriptbespreking");
    expect(classifyAppointment("Scripts schrijven Donkergroen")).toBe("scriptbespreking");
  });
  it("herkent 'short online' als publicatie, maar een online meeting niet", () => {
    expect(classifyAppointment("Marco van beek short online > 16:00")).toBe("publicatie");
    expect(classifyAppointment("Online meeting met lead")).toBe("overig");
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

describe("interne afspraken herkennen", () => {
  it("herkent duidelijk interne afspraken zonder externe deelnemer", () => {
    // Echte titels uit de ShortClips-agenda.
    for (const title of [
      "JISKA VRIJ > ELKE DONDERDAG",
      "Milou - Kantinedienst",
      "Kantoordag - Shortclips",
      "16:00 - VASTE WELKELIJKSE team meeting - EVALUATIE",
      "16:30 - VRIJDAGMIDDAG BORREL - TEAM SHORTCLIPS",
      "BRANDING + AAN HET BEDRIJF WERKEN - KANTOOR JARNO",
      "Behind the scenes maken",
      "Milou LinkedIn post online (eigen kanaal)",
      "Factuur Max betalen",
      "60 MIN SCRIPT TRAINING - MILOU / JISKA",
      "VERJAARDAG MILOU - 24 JAAR",
      "Milou Tandarts",
      "UITBETALING Milou, Rutger en Jiska",
      "LUNCHEN TEAM",
      "JISKA mee met opname",
    ]) {
      expect(isInternalAppointment(event(title))).toBe(true);
    }
  });

  it("markeert een afspraak NIET als intern zodra er iemand van buiten bij zit", () => {
    // Een lead/partner met externe deelnemer hoort juist wél ter controle.
    expect(
      isInternalAppointment(event("Kennismaking WineDrops", ["julian@winedrops.nl"])),
    ).toBe(false);
  });

  it("ziet een echte klantopname niet als intern", () => {
    expect(isInternalAppointment(event("9:00 - 365Werk opnamesessie - 8 shorts"))).toBe(false);
    expect(isInternalAppointment(event("Shortclips x SHADES monthly shootday"))).toBe(false);
  });

  it("behandelt interne planningsagenda's als intern", () => {
    expect(isInternalAppointment(event("Dag vullen"), "Dagindeling - Shortclips")).toBe(true);
  });
});
