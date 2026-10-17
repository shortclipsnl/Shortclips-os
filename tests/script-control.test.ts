import { describe, expect, it } from "vitest";
import { estimateSpeakingTime, DEFAULT_WPM } from "@/server/script-control";

describe("estimateSpeakingTime", () => {
  it("telt woorden over hook/body/cta en rekent seconden bij standaardtempo", () => {
    const r = estimateSpeakingTime({ hook: "een twee drie", body: "vier vijf zes zeven", cta: "acht" });
    expect(r.perSection).toEqual({ hook: 3, body: 4, cta: 1 });
    expect(r.words).toBe(8);
    expect(r.wpm).toBe(DEFAULT_WPM);
    expect(r.seconds).toBe(Math.round((8 / DEFAULT_WPM) * 60)); // = 3
  });

  it("behandelt lege/ontbrekende secties als nul woorden", () => {
    const r = estimateSpeakingTime({ hook: "  ", body: null, cta: undefined });
    expect(r.words).toBe(0);
    expect(r.seconds).toBe(0);
    expect(r.perSection).toEqual({ hook: 0, body: 0, cta: 0 });
  });

  it("schaalt met een gekalibreerd spreektempo (klant-wpm uit VI)", () => {
    const parts = { hook: "woord ".repeat(150).trim() };
    const traag = estimateSpeakingTime(parts, 100);
    const snel = estimateSpeakingTime(parts, 200);
    expect(traag.words).toBe(150);
    expect(traag.seconds).toBe(90); // 150 woorden @ 100 wpm
    expect(snel.seconds).toBe(45); // zelfde tekst, sneller tempo
  });

  it("valt veilig terug bij een onzinnig tempo van 0", () => {
    const r = estimateSpeakingTime({ body: "een twee" }, 0);
    expect(r.seconds).toBe(0);
  });
});
