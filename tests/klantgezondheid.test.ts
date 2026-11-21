import { describe, expect, it } from "vitest";
import { baselineY, redenOf, sortRows, sparkPoints, statusOf, viewsPctOf, type GezondheidInput, type GezondheidRow } from "@/lib/klantgezondheid";

const base: GezondheidInput = {
  resultsState: "ok", viewsPct: 0, lateCount: 0, lateDays: 0, renewalSoon: false, feedbackSerious: 0, feedbackUnhappy: 0,
};
const klant = (o: Partial<GezondheidInput>): GezondheidInput => ({ ...base, ...o });

describe("klantgezondheid: status", () => {
  it("dalende resultaten én late levering is spoed", () => {
    expect(statusOf(klant({ resultsState: "daling", viewsPct: -34, lateCount: 1, lateDays: 4 }))).toBe("spoed");
  });
  it("dalende resultaten met verlengmoment binnen 60 dagen is spoed", () => {
    expect(statusOf(klant({ resultsState: "daling", viewsPct: -31, renewalSoon: true }))).toBe("spoed");
  });
  it("dalende resultaten met een open klacht is spoed", () => {
    expect(statusOf(klant({ resultsState: "daling", feedbackUnhappy: 1 }))).toBe("spoed");
  });
  it("ernstig klantsignaal is altijd spoed", () => {
    expect(statusOf(klant({ feedbackSerious: 1 }))).toBe("spoed");
  });
  it("drie open klachten is spoed", () => {
    expect(statusOf(klant({ feedbackUnhappy: 3 }))).toBe("spoed");
  });
  it("een open klacht bij late levering is spoed", () => {
    expect(statusOf(klant({ feedbackUnhappy: 1, lateCount: 1, lateDays: 2 }))).toBe("spoed");
  });
  it("alleen dalende resultaten is bijsturen", () => {
    expect(statusOf(klant({ resultsState: "daling", viewsPct: -28 }))).toBe("bijsturen");
  });
  it("alleen een open klacht is bijsturen", () => {
    expect(statusOf(klant({ feedbackUnhappy: 1 }))).toBe("bijsturen");
  });
  it("alleen late levering is inhalen, ook bij goede resultaten", () => {
    expect(statusOf(klant({ viewsPct: 12, lateCount: 2, lateDays: 6 }))).toBe("inhalen");
  });
  it("een naderend verlengmoment alleen maakt een klant niet ongezond", () => {
    expect(statusOf(klant({ renewalSoon: true }))).toBe("koers");
  });
  it("geen betrouwbare data geeft geen oordeel in plaats van op koers", () => {
    expect(statusOf(klant({ resultsState: "geen_koppeling" }))).toBe("geen_data");
    expect(statusOf(klant({ resultsState: "verouderd" }))).toBe("geen_data");
    expect(statusOf(klant({ resultsState: "onvoldoende_data" }))).toBe("geen_data");
  });
  it("late levering gaat voor ontbrekende data", () => {
    expect(statusOf(klant({ resultsState: "geen_koppeling", lateCount: 1, lateDays: 3 }))).toBe("inhalen");
  });
  it("goed en op schema is op koers", () => {
    expect(statusOf(klant({ viewsPct: 22 }))).toBe("koers");
  });
});

describe("klantgezondheid: reden", () => {
  it("noemt de aantoonbare feiten kort", () => {
    const i = klant({ resultsState: "daling", viewsPct: -34, lateCount: 1, lateDays: 4, renewalSoon: true });
    expect(redenOf(i, statusOf(i))).toBe("Weergaven -34%, 4 dagen te laat, verlenging binnen 60 dagen");
  });
  it("meerdere late video's worden samengevat", () => {
    const i = klant({ lateCount: 3, lateDays: 6 });
    expect(redenOf(i, "inhalen")).toBe("3 video's te laat, tot 6 dagen");
  });
  it("legt uit waarom er geen oordeel is", () => {
    expect(redenOf(klant({ resultsState: "geen_koppeling" }), "geen_data")).toBe("Geen resultatenkoppeling");
  });
  it("gebruikt geen em dash", () => {
    const i = klant({ resultsState: "daling", viewsPct: -34, lateCount: 1, lateDays: 4 });
    expect(redenOf(i, "spoed")).not.toContain("—");
  });
});

describe("klantgezondheid: trendlijntje", () => {
  it("geeft niets bij te weinig weken data", () => {
    expect(sparkPoints([0, 0, 0, 100, 120])).toBeNull();
    expect(sparkPoints([100, 100])).toBeNull();
  });
  it("gebruikt een vaste schaal: een daling van 34% staat lager dan een stijging van 2%", () => {
    const y = (s: string) => Number(s.split(" ").at(-1)!.split(",")[1]);
    const dal = sparkPoints([100, 100, 100, 100, 100, 90, 78, 66])!;
    const vlak = sparkPoints([100, 100, 100, 100, 100, 101, 101, 102])!;
    expect(y(dal)).toBeGreaterThan(y(vlak)); // hogere y = lager op het scherm
    expect(y(vlak)).toBeLessThan(baselineY() + 1);
  });
  it("klemt extreme waarden binnen de schaal", () => {
    const pts = sparkPoints([100, 100, 100, 100, 100, 100, 100, 1000])!;
    const ys = pts.split(" ").map((p) => Number(p.split(",")[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(3);
  });
});

describe("klantgezondheid: weergaven-verandering en volgorde", () => {
  it("kiest bij daling de slechtste platform", () => {
    const pct = viewsPctOf([
      { state: "ok", changes: [{ key: "weergaven", pct: 5, cur: 9000 }] },
      { state: "daling", changes: [{ key: "weergaven", pct: -34, cur: 1000 }] },
    ]);
    expect(pct).toBe(-34);
  });
  it("kiest zonder daling het grootste platform", () => {
    const pct = viewsPctOf([
      { state: "ok", changes: [{ key: "weergaven", pct: 40, cur: 100 }] },
      { state: "ok", changes: [{ key: "weergaven", pct: 8, cur: 9000 }] },
    ]);
    expect(pct).toBe(8);
  });
  it("sorteert spoed bovenaan en op koers onderaan", () => {
    const r = (name: string, status: GezondheidRow["status"], viewsPct: number | null = 0): GezondheidRow => ({
      clientId: name, name, slug: name, logoUrl: null, color: null, status, reden: "", viewsPct, series: [],
      lateCount: 0, lateDays: 0, renewalSoon: false, feedbackSerious: 0, feedbackUnhappy: 0, resultsState: "ok", ownerId: null, ownerName: null,
    });
    const sorted = sortRows([r("A", "koers"), r("B", "inhalen"), r("C", "spoed", -10), r("D", "spoed", -40), r("E", "bijsturen")]);
    expect(sorted.map((x) => x.name)).toEqual(["D", "C", "E", "B", "A"]);
  });
});
