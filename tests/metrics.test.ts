import { describe, expect, it } from "vitest";
import { editorLoad, levelFromPct } from "@/lib/metrics";

/** Eén definitie per cijfer (#5): de drempel is overal gelijk. */
describe("editorbelasting — één drempel", () => {
  it("levelFromPct: <80 normaal, 80-100 hoog, >100 overbelast", () => {
    expect(levelFromPct(0)).toBe("normaal");
    expect(levelFromPct(79)).toBe("normaal");
    expect(levelFromPct(80)).toBe("hoog");
    expect(levelFromPct(100)).toBe("hoog");
    expect(levelFromPct(101)).toBe("overbelast");
    expect(levelFromPct(null)).toBe("geen_data");
  });

  it("editorLoad: bezetting en oordeel uit shorts/4wk-grens", () => {
    expect(editorLoad(10, 20)).toEqual({ pct: 50, level: "normaal" });
    expect(editorLoad(17, 20)).toEqual({ pct: 85, level: "hoog" });
    expect(editorLoad(25, 20)).toEqual({ pct: 125, level: "overbelast" });
    expect(editorLoad(5, 0)).toEqual({ pct: null, level: "geen_data" });
    expect(editorLoad(5, null)).toEqual({ pct: null, level: "geen_data" });
  });
});
