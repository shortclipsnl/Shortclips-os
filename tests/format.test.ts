import { describe, expect, it } from "vitest";
import { compact, daysSince, euro, num, periodLabel, plural } from "@/lib/format";
import { monthGrid } from "@/server/calendar";
import { VIDEO_STAGES, VIDEO_STATUS, stageOverdue } from "@/lib/statuses";

describe("weergave", () => {
  it("gebruikt Nederlandse getalnotatie", () => {
    expect(num(1234567)).toBe("1.234.567");
    expect(num(null)).toBe("–");
  });

  it("kort grote aantallen af", () => {
    expect(compact(950)).toBe("950");
    expect(compact(12400)).toBe("12,4k");
    expect(compact(2_500_000)).toBe("2,5M");
  });

  it("toont bedragen in euro's", () => {
    expect(euro(2450)).toContain("2.450");
    expect(euro(0)).toContain("0");
  });

  it("vervoegt enkelvoud en meervoud correct", () => {
    expect(plural(1, "script")).toBe("1 script");
    expect(plural(3, "script")).toBe("3 scripts");
    expect(plural(1, "video", "video's")).toBe("1 video");
    expect(plural(2, "video", "video's")).toBe("2 video's");
  });

  it("geeft nooit een negatief aantal dagen terug", () => {
    const future = new Date(Date.now() + 86400000);
    expect(daysSince(future)).toBe(0);
  });

  it("schrijft periodes voluit", () => {
    expect(periodLabel("2026-08")).toBe("augustus 2026");
  });
});

describe("kalenderraster", () => {
  it("begint op maandag en vult hele weken", () => {
    const weeks = monthGrid(2026, 8);
    expect(weeks[0]).toHaveLength(7);
    const first = new Date(weeks[0]![0]! + "T00:00:00Z");
    expect(first.getUTCDay()).toBe(1);
  });

  it("bevat elke dag van de maand", () => {
    const weeks = monthGrid(2026, 2);
    const days = weeks.flat();
    expect(days).toContain("2026-02-01");
    expect(days).toContain("2026-02-28");
  });
});

describe("pipelinestatussen", () => {
  it("heeft voor elke stap een label en een toon", () => {
    for (const stage of VIDEO_STAGES) {
      expect(VIDEO_STATUS[stage]?.label).toBeTruthy();
      expect(VIDEO_STATUS[stage]?.short).toBeTruthy();
    }
  });

  it("markeert overschrijding van de streeftijd", () => {
    expect(stageOverdue("client_review", 2)).toBe(false);
    expect(stageOverdue("client_review", 9)).toBe(true);
    // Gepubliceerd kent geen streeftijd.
    expect(stageOverdue("published", 200)).toBe(false);
  });
});
