import { describe, expect, it } from "vitest";
import { shotsFromCuts, editingMetrics } from "@/server/video-intelligence/ffmpeg";
import { speechStats, mean, median } from "@/server/video-intelligence/metrics";

describe("shotsFromCuts — shots uit scene-grenzen", () => {
  it("geen cuts → één shot over de hele duur", () => {
    expect(shotsFromCuts([], 10000)).toEqual([{ idx: 0, startMs: 0, endMs: 10000 }]);
  });

  it("twee cuts → drie shots op de juiste grenzen", () => {
    expect(shotsFromCuts([3000, 6000], 10000)).toEqual([
      { idx: 0, startMs: 0, endMs: 3000 },
      { idx: 1, startMs: 3000, endMs: 6000 },
      { idx: 2, startMs: 6000, endMs: 10000 },
    ]);
  });

  it("negeert cuts vlak bij begin/eind en dubbele waarden", () => {
    // 100ms (te vroeg) en 9950ms (te laat) vallen weg; 5000 dubbel telt één keer.
    expect(shotsFromCuts([100, 5000, 5000, 9950], 10000)).toEqual([
      { idx: 0, startMs: 0, endMs: 5000 },
      { idx: 1, startMs: 5000, endMs: 10000 },
    ]);
  });
});

describe("editingMetrics — montage uit shots", () => {
  it("rekent totalen, gemiddelden en cuts per 10s", () => {
    const shots = [
      { idx: 0, startMs: 0, endMs: 2000 },
      { idx: 1, startMs: 2000, endMs: 3000 },
      { idx: 2, startMs: 3000, endMs: 9000 },
    ];
    const m = editingMetrics(shots, 9000);
    expect(m.totalShots).toBe(3);
    expect(m.avgShotMs).toBe(3000); // (2000+1000+6000)/3
    expect(m.minShotMs).toBe(1000);
    expect(m.maxShotMs).toBe(6000);
    expect(m.cutsPer10s).toBe(2); // (3-1)/9000*10000 ≈ 2.22 → 2
  });

  it("leeg/één shot blijft veilig", () => {
    const m = editingMetrics([{ idx: 0, startMs: 0, endMs: 5000 }], 5000);
    expect(m.totalShots).toBe(1);
    expect(m.cutsPer10s).toBe(0);
  });
});

describe("speechStats — spreeksnelheid", () => {
  it("telt woorden per tijdvenster en wpm", () => {
    const words = [
      { w: "hallo", start: 500, end: 800 },
      { w: "dit", start: 1200, end: 1400 },
      { w: "is", start: 3500, end: 3700 },
      { w: "een", start: 6000, end: 6200 },
    ];
    const s = speechStats(words, 60000); // 1 minuut → 4 wpm
    expect(s.wpm).toBe(4);
    expect(s.firstWordMs).toBe(500);
    expect(s.words3s).toBe(2); // 500 + 1200
    expect(s.words5s).toBe(3); // + 3500
    expect(s.words10s).toBe(4); // + 6000
  });

  it("leeg transcript → nullen", () => {
    expect(speechStats([], 10000)).toEqual({ wpm: null, firstWordMs: null, words3s: 0, words5s: 0, words10s: 0 });
  });
});

describe("mean/median — benchmark-cohorten", () => {
  it("mean rondt af, median pakt het midden", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([1, 2])).toBe(2); // 1.5 → 2 (afgerond)
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3); // (2+3)/2 = 2.5 → 3
  });

  it("leeg cohort → null", () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
  });
});
