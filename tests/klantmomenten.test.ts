import { describe, expect, it } from "vitest";
import { addYears, attentionProposal, computeMoments, isDue, momentLabel, yearOnlyJubilee } from "@/lib/klantmomenten";

describe("klantmomenten", () => {
  it("vindt het eerste samenwerkingsjaar en zet de taak een week vooraf", () => {
    const m = computeMoments({ start: { date: "2025-11-18", status: "indicatie" }, foundedOn: null, foundedYear: null }, "2026-11-12", 30);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "samenwerking", years: 1, date: "2026-11-18", taskOn: "2026-11-11", status: "indicatie" });
    expect(isDue(m[0]!, "2026-11-12")).toBe(true);
    expect(isDue(m[0]!, "2026-11-10")).toBe(false);
    expect(isDue(m[0]!, "2026-11-19")).toBe(false);
  });

  it("bedrijfsjubileum alleen per 5 jaar", () => {
    const m = computeMoments({ start: null, foundedOn: "1998-06-01", foundedYear: 1998 }, "2026-11-12", 800);
    expect(m.map((x) => [x.years, x.date])).toEqual([[30, "2028-06-01"]]);
    expect(momentLabel(m[0]!)).toBe("30 jaar bestaan");
  });

  it("alleen een jaartal: jubileumjaar zonder melding", () => {
    expect(yearOnlyJubilee({ start: null, foundedOn: null, foundedYear: 1961 }, "2026-11-12")).toEqual({ year: 2026, years: 65 });
    expect(yearOnlyJubilee({ start: null, foundedOn: null, foundedYear: 1929 }, "2026-11-12")).toEqual({ year: 2029, years: 100 });
    expect(yearOnlyJubilee({ start: null, foundedOn: "1929-01-01", foundedYear: 1929 }, "2026-11-12")).toBeNull();
  });

  it("schrikkeldag valt terug op 28 februari", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
  });

  it("voorstel attentie per moment", () => {
    expect(attentionProposal({ kind: "samenwerking", years: 1 })).toBe("persoonlijk kaartje");
    expect(attentionProposal({ kind: "bedrijf", years: 100 })).toContain("Jarno");
  });
});
