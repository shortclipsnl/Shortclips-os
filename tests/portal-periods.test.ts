import { describe, expect, it } from "vitest";
import { describePeriod, monthsOfQuarter, parsePortalPeriod, periodOptions, periodResultOpts, portalPeriodQuery, quarterKeyOf, shiftQuarterKey } from "@/lib/portal-periods";

const TODAY = "2026-11-15";

describe("periodekeuze resultaten (maand en kwartaal)", () => {
  it("kiest zonder keuze de lopende maand en vergelijkt met dezelfde dagen van de vorige maand", () => {
    const p = parsePortalPeriod({}, TODAY);
    expect(p).toMatchObject({ key: "2026-11", mode: "maand", from: "2026-11-01", to: "2026-11-15", days: 15, complete: false });
    expect(p).toMatchObject({ prevFrom: "2026-10-01", prevTo: "2026-10-15", prevLabel: "oktober 2026", label: "november 2026" });
  });

  it("een afgeronde maand loopt van de eerste tot de laatste dag en vergelijkt met de hele maand ervoor", () => {
    const p = parsePortalPeriod({ periode: "2026-10" }, TODAY);
    expect(p).toMatchObject({ from: "2026-10-01", to: "2026-10-31", days: 31, complete: true, prevFrom: "2026-09-01", prevTo: "2026-09-30" });
  });

  it("een afgerond kwartaal vergelijkt met het hele kwartaal ervoor, ook over de jaargrens", () => {
    const q3 = parsePortalPeriod({ periode: "2026-Q3" }, TODAY);
    expect(q3).toMatchObject({ mode: "kwartaal", from: "2026-07-01", to: "2026-09-30", days: 92, complete: true, prevFrom: "2026-04-01", prevTo: "2026-06-30", label: "Q3 2026", prevLabel: "Q2 2026" });
    const q1 = parsePortalPeriod({ periode: "2026-Q1" }, TODAY);
    expect(q1).toMatchObject({ prevFrom: "2025-10-01", prevTo: "2025-12-31", prevLabel: "Q4 2025" });
    expect(shiftQuarterKey("2026-Q1", -1)).toBe("2025-Q4");
  });

  it("een lopend kwartaal stopt vandaag en vergelijkt met evenveel dagen van het vorige kwartaal", () => {
    const p = parsePortalPeriod({ periode: "2026-Q4" }, TODAY);
    expect(p).toMatchObject({ from: "2026-10-01", to: "2026-11-15", days: 46, complete: false, prevFrom: "2026-07-01", prevTo: "2026-08-15" });
  });

  it("de vergelijkingsperiode loopt nooit voorbij het einde van de vorige maand", () => {
    const p = parsePortalPeriod({ periode: "2026-03" }, "2026-03-31");
    expect(p).toMatchObject({ days: 31, complete: false, prevFrom: "2026-02-01", prevTo: "2026-02-28" });
  });

  it("een periode in de toekomst valt terug op de lopende maand", () => {
    expect(parsePortalPeriod({ periode: "2027-02" }, TODAY).key).toBe("2026-11");
    expect(parsePortalPeriod({ periode: "2027-Q1" }, TODAY).key).toBe("2026-11");
    expect(parsePortalPeriod({ periode: "onzin" }, TODAY).key).toBe("2026-11");
  });

  it("oude links blijven werken", () => {
    expect(parsePortalPeriod({ periode: "maand" }, TODAY).key).toBe("2026-11");
    expect(parsePortalPeriod({ periode: "vorigemaand" }, TODAY).key).toBe("2026-10");
    expect(parsePortalPeriod({ periode: "90" }, TODAY)).toMatchObject({ key: "90", days: 90, mode: "vrij" });
    const c = parsePortalPeriod({ periode: "custom", van: "2026-01-05", tot: "2026-01-11" }, TODAY);
    expect(c).toMatchObject({ key: "custom", days: 7, mode: "vrij", from: "2026-01-05", to: "2026-01-11" });
    expect(portalPeriodQuery(c)).toBe("periode=custom&van=2026-01-05&tot=2026-01-11");
    expect(portalPeriodQuery(parsePortalPeriod({ periode: "2026-Q3" }, TODAY))).toBe("periode=2026-Q3");
  });

  it("doorlopende perioden krijgen geen vaste vergelijkingsperiode mee", () => {
    const o = periodResultOpts(parsePortalPeriod({ periode: "30" }, TODAY));
    expect(o.prevFrom).toBeUndefined();
    expect(o.from).toBeUndefined();
    expect(o.periodKey).toBe("30");
  });

  it("toont alleen maanden en kwartalen vanaf de eerste cijfers", () => {
    const o = periodOptions("2026-05-20", TODAY);
    expect(o.months.map((m) => m.key)).toEqual(["2026-11", "2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(o.quarters.map((q) => q.key)).toEqual(["2026-Q4", "2026-Q3", "2026-Q2"]);
    const none = periodOptions(null, TODAY);
    expect(none.months).toHaveLength(1);
    expect(none.quarters).toHaveLength(1);
  });

  it("beschrijft een periode vanuit de resultaten", () => {
    expect(describePeriod("2026-Q3", "2026-07-01", "2026-09-30", TODAY)).toMatchObject({ mode: "kwartaal", label: "Q3 2026" });
    expect(describePeriod("custom", "2026-01-05", "2026-01-11", TODAY).mode).toBe("vrij");
    expect(monthsOfQuarter("2026-Q4")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(quarterKeyOf("2026-11-15")).toBe("2026-Q4");
  });
});
