import { describe, expect, it } from "vitest";
import { projectRisk } from "@/server/risk";

describe("projectRisk — transparante risicoregels", () => {
  it("te laat → rood met reden", () => {
    const r = projectRisk({ isLate: true, daysToDeadline: -2, status: "editing" });
    expect(r.level).toBe("rood");
    expect(r.factors[0]).toMatch(/verstreken/i);
  });

  it("deadline nabij terwijl nog in bewerking → oranje (voorspellend)", () => {
    const r = projectRisk({ isLate: false, daysToDeadline: 2, status: "editing" });
    expect(r.level).toBe("oranje");
    expect(r.factors.join(" ")).toMatch(/nog in bewerking/i);
  });

  it("ruime deadline, in bewerking → groen", () => {
    expect(projectRisk({ isLate: false, daysToDeadline: 9, status: "editing" }).level).toBe("groen");
  });

  it("lang geen klantfeedback → oranje", () => {
    const r = projectRisk({ isLate: false, daysToDeadline: 10, status: "client_review", daysAtClient: 6 });
    expect(r.level).toBe("oranje");
    expect(r.factors.join(" ")).toMatch(/klantfeedback/i);
  });

  it("overbelaste editor telt als factor", () => {
    const r = projectRisk({ isLate: false, daysToDeadline: 10, status: "editing", editorOverloaded: true });
    expect(r.level).toBe("oranje");
    expect(r.factors.join(" ")).toMatch(/overbelast/i);
  });

  it("niets aan de hand → groen, geen factoren", () => {
    expect(projectRisk({ isLate: false, daysToDeadline: null, status: "approved" })).toEqual({ level: "groen", factors: [] });
  });
});
