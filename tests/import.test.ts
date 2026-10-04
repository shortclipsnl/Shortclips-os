import { describe, expect, it } from "vitest";
import { matchScore, normalizeName } from "@/server/import";

describe("naamherkenning bij importeren", () => {
  it("negeert spaties, hoofdletters en rechtsvormen", () => {
    expect(normalizeName("Friesland Lease B.V.")).toBe("frieslandlease");
    expect(normalizeName("FrieslandLease")).toBe("frieslandlease");
  });

  it("negeert jaartallen in mapnamen", () => {
    expect(normalizeName("Friesland Lease 2026")).toBe("frieslandlease");
  });

  it("herkent dezelfde klant in Monday, Frame.io en Drive", () => {
    expect(matchScore("Friesland Lease", "Friesland Lease")).toBe(100);
    expect(matchScore("FrieslandLease", "Friesland Lease")).toBe(100);
    expect(matchScore("Friesland Lease 2026", "Friesland Lease")).toBe(100);
  });

  it("geeft een lagere score bij gedeeltelijke overeenkomst", () => {
    const score = matchScore("Friesland Lease Noord", "Friesland Lease");
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });

  it("koppelt niet-verwante namen niet", () => {
    expect(matchScore("Donkergroen", "Kempernet")).toBe(0);
    expect(matchScore("", "Kempernet")).toBe(0);
  });
});
