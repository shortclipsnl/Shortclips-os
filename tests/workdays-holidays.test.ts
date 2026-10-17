import { describe, expect, it } from "vitest";
import { addWorkingDays, workingDaysUntil } from "@/lib/workdays";
import { nlHolidaysForYear, nlHolidaySet } from "@/lib/holidays";

describe("addWorkingDays met feestdagen", () => {
  it("slaat weekenden over (ongewijzigd gedrag zonder feestdagen)", () => {
    // 2024-01-05 = vrijdag → +1 werkdag = maandag 2024-01-08.
    expect(addWorkingDays("2024-01-05", 1)).toBe("2024-01-08");
  });
  it("slaat ook een meegegeven feestdag over", () => {
    const holidays = new Set(["2024-01-08"]);
    expect(addWorkingDays("2024-01-05", 1, holidays)).toBe("2024-01-09");
  });
});

describe("workingDaysUntil (met teken)", () => {
  it("telt werkdagen tot een toekomstige deadline", () => {
    expect(workingDaysUntil("2024-01-05", "2024-01-08")).toBe(1); // vrij → maa
  });
  it("is 0 op de dag zelf en negatief na de deadline", () => {
    expect(workingDaysUntil("2024-01-08", "2024-01-08")).toBe(0);
    expect(workingDaysUntil("2024-01-08", "2024-01-05")).toBe(-1);
  });
});

describe("nlHolidaysForYear", () => {
  it("verschuift Koningsdag naar 26 april als 27 april een zondag is (2025)", () => {
    const h = nlHolidaysForYear(2025);
    expect(h).toContain("2025-04-26");
    expect(h).not.toContain("2025-04-27");
  });
  it("bevat vaste feestdagen en 1e Paasdag (2025-04-20)", () => {
    const h = nlHolidaysForYear(2025);
    expect(h).toContain("2025-01-01");
    expect(h).toContain("2025-12-25");
    expect(h).toContain("2025-12-26");
    expect(h).toContain("2025-05-05");
    expect(h).toContain("2025-04-20"); // 1e Paasdag 2025
  });
  it("nlHolidaySet bundelt meerdere jaren", () => {
    const set = nlHolidaySet([2024, 2025]);
    expect(set.has("2024-12-25")).toBe(true);
    expect(set.has("2025-12-25")).toBe(true);
  });
});
