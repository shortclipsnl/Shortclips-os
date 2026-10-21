import { describe, expect, it } from "vitest";
import { computeGoalStatus, type GoalStatusInput } from "@/server/goals/status";

// Q4 2026 als vast kader.
const Q4 = { startDate: "2026-10-01", endDate: "2026-12-31" };
const base = (over: Partial<GoalStatusInput> = {}): GoalStatusInput => ({
  type: "count",
  source: "live",
  ...Q4,
  current: 0,
  target: 10,
  ...over,
});
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("computeGoalStatus", () => {
  it("gepland: vóór de startdatum", () => {
    expect(computeGoalStatus(base(), at("2026-09-20")).status).toBe("gepland");
  });

  it("gepland wint ook als er nog geen doel is ingesteld", () => {
    expect(computeGoalStatus(base({ target: null }), at("2026-09-20")).status).toBe("gepland");
  });

  it("gehaald zodra current het doel bereikt (count)", () => {
    expect(computeGoalStatus(base({ current: 10 }), at("2026-11-15")).status).toBe("gehaald");
    expect(computeGoalStatus(base({ current: 11 }), at("2026-11-15")).status).toBe("gehaald");
  });

  it("norm: pas gehaald na 4 weken op rij", () => {
    const norm = base({ type: "norm", target: 90, current: 95 });
    expect(computeGoalStatus({ ...norm, normConsecutiveHits: 2 }, at("2026-11-15")).status).toBe("op_koers");
    expect(computeGoalStatus({ ...norm, normConsecutiveHits: 4 }, at("2026-11-15")).status).toBe("gehaald");
  });

  it("niet_bijgewerkt: handmatig doel langer dan 7 dagen geen update", () => {
    const r = computeGoalStatus(
      base({ source: "manual", current: 2, lastUpdateAt: "2026-11-01" }),
      at("2026-11-15"),
    );
    expect(r.status).toBe("niet_bijgewerkt");
  });

  it("niet_bijgewerkt overschrijft gehaald niet", () => {
    const r = computeGoalStatus(
      base({ source: "manual", current: 10, lastUpdateAt: "2026-10-01" }),
      at("2026-11-15"),
    );
    expect(r.status).toBe("gehaald");
  });

  it("verse handmatige update telt niet als niet_bijgewerkt", () => {
    const r = computeGoalStatus(
      base({ source: "manual", current: 5, lastUpdateAt: "2026-11-14" }),
      at("2026-11-15"),
    );
    expect(r.status).not.toBe("niet_bijgewerkt");
  });

  it("op koers: current gelijk aan het verwachte tempo", () => {
    // ~halverwege het kwartaal; verwacht ~5 van de 10.
    const r = computeGoalStatus(base({ current: 5 }), at("2026-11-16"));
    expect(r.status).toBe("op_koers");
    expect(r.measurable).toBe(true);
  });

  it("risico: achterstand tussen 5% en 15%", () => {
    const r = computeGoalStatus(base({ current: 4.6 }), at("2026-11-16"));
    expect(r.status).toBe("risico");
    expect(r.shortfallPct).toBeGreaterThan(0.05);
    expect(r.shortfallPct).toBeLessThanOrEqual(0.15);
  });

  it("achter: achterstand groter dan 15%", () => {
    const r = computeGoalStatus(base({ current: 4 }), at("2026-11-16"));
    expect(r.status).toBe("achter");
    expect(r.shortfallPct).toBeGreaterThan(0.15);
  });

  it("achter via tempo-regel dicht op de deadline (ook bij kleine achterstand)", () => {
    // current 8/10, lichte achterstand, maar benodigd tempo > 1,2x huidig tempo.
    const r = computeGoalStatus(base({ current: 8 }), at("2026-12-21"));
    expect(r.status).toBe("achter");
  });

  it("niet meetbaar als er geen doel is ingesteld (Doel nog instellen)", () => {
    const r = computeGoalStatus(base({ target: null, current: 3 }), at("2026-11-16"));
    expect(r.measurable).toBe(false);
    expect(r.status).toBe("op_koers");
  });

  it("norm met achterstand levert risico of achter", () => {
    // 70/90 = 22% achter → achter; 85/90 = 5,6% achter → risico.
    expect(computeGoalStatus(base({ type: "norm", target: 90, current: 70 }), at("2026-11-16")).status).toBe("achter");
    expect(computeGoalStatus(base({ type: "norm", target: 90, current: 85 }), at("2026-11-16")).status).toBe("risico");
  });
});
