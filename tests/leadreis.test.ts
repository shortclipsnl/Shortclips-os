import { describe, expect, it } from "vitest";
import {
  currentPhase,
  effectiveStatus,
  emptyFacts,
  journeyTaskDedupe,
  missingLinks,
  PHASES,
  phaseProgress,
  renderMessage,
  type PhaseState,
} from "@/lib/lead-journey";

describe("leadreis fases", () => {
  it("heeft 8 fases in vaste volgorde met unieke sleutels", () => {
    expect(PHASES).toHaveLength(8);
    expect(PHASES.map((p) => p.nr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(PHASES.map((p) => p.key)).size).toBe(8);
  });

  it("WhatsAppgroep-fase heeft de 7 afgesproken acties", () => {
    expect(PHASES.find((p) => p.key === "whatsapp")!.checklist).toHaveLength(7);
  });

  it("de huidige fase is de eerste die niet klaar is", () => {
    expect(currentPhase({})!.key).toBe("binnen");
    expect(currentPhase({ binnen: { status: "klaar" }, kennismaking: { status: "klaar" } })!.key).toBe("voorstel");
    const alles = Object.fromEntries(PHASES.map((p) => [p.key, { status: "klaar" } as PhaseState]));
    expect(currentPhase(alles)).toBeNull();
  });

  it("vinkt punten automatisch af op basis van feiten", () => {
    const def = PHASES.find((p) => p.key === "ondertekend")!;
    expect(phaseProgress(def, undefined, emptyFacts)).toEqual({ done: 0, total: 3 });
    expect(phaseProgress(def, undefined, { ...emptyFacts, quoteSigned: true, clientCreated: true })).toEqual({ done: 2, total: 3 });
    expect(phaseProgress(def, { status: "bezig", checks: { bedankt: true } }, { ...emptyFacts, quoteSigned: true, clientCreated: true })).toEqual({ done: 3, total: 3 });
  });

  it("een latere fase blijft 'nog niet gestart' zolang de vorige niet klaar is", () => {
    const voorstel = PHASES.find((p) => p.key === "voorstel")!;
    expect(effectiveStatus(voorstel, {}, emptyFacts)).toBe("nog_niet");
    expect(effectiveStatus(voorstel, { binnen: { status: "klaar" }, kennismaking: { status: "klaar" } }, emptyFacts)).toBe("nog_niet");
    expect(effectiveStatus(voorstel, { binnen: { status: "klaar" }, kennismaking: { status: "klaar" } }, { ...emptyFacts, quoteSent: true })).toBe("bezig");
    expect(effectiveStatus(voorstel, { voorstel: { status: "wacht_klant" } }, emptyFacts)).toBe("wacht_klant");
  });

  it("taak-sleutel is stabiel per lead en fase", () => {
    expect(journeyTaskDedupe("abc", "voorstel")).toBe("journey:abc:voorstel");
  });
});

describe("berichten", () => {
  it("vult voornaam en bedrijf in", () => {
    const t = renderMessage("Hi {voornaam}, welkom {bedrijf}", { voornaam: "Jan de Vries", bedrijf: "Zocon" });
    expect(t).toBe("Hi Jan, welkom Zocon");
  });

  it("verzint nooit een link: ontbrekende waarde blijft zichtbaar", () => {
    const t = renderMessage("Link: {pandadoc_link} en {kickoff_link}", { pandadoc_link: "https://app.pandadoc.com/x", kickoff_link: "" });
    expect(t).toContain("https://app.pandadoc.com/x");
    expect(t).toContain("[nog koppelen: kickofflink]");
    expect(missingLinks(t)).toEqual(["kickofflink"]);
  });

  it("laat onbekende accolades ongemoeid", () => {
    expect(renderMessage("{onbekend}", {})).toBe("{onbekend}");
  });
});
