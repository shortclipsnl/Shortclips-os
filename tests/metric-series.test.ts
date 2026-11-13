import { describe, expect, it } from "vitest";
import { isCumulativeSeries, toDailySeries } from "@/lib/metric-series";

const days = (vals: number[]) => vals.map((value, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, value }));

describe("metric-series", () => {
  it("herkent een oplopende totaalstand (TikTok-likes) en zet die om naar per dag", () => {
    const s = days([84124, 84130, 84141, 84141, 84150, 84160, 84171, 84881]);
    expect(isCumulativeSeries(s)).toBe(true);
    const d = toDailySeries(s);
    expect(d.map((p) => p.value)).toEqual([0, 6, 11, 0, 9, 10, 11, 710]);
  });

  it("laat een gewone dagreeks met schommelingen ongemoeid", () => {
    const s = days([120, 340, 90, 0, 410, 230, 180, 260]);
    expect(isCumulativeSeries(s)).toBe(false);
    expect(toDailySeries(s)).toEqual(s);
  });

  it("laat een korte reeks en een reeks met nullen ongemoeid", () => {
    expect(isCumulativeSeries(days([500, 501, 502]))).toBe(false);
    expect(isCumulativeSeries(days([0, 0, 3, 3, 3, 4, 5, 6]))).toBe(false);
  });

  it("staat een kleine daling (weggehaalde like) toe, maar geen echte daling", () => {
    expect(isCumulativeSeries(days([2261, 2262, 2261, 2262, 2262, 2262, 2263, 2262]))).toBe(true);
    expect(isCumulativeSeries(days([2261, 2262, 1800, 2262, 2262, 2262, 2263, 2262]))).toBe(false);
  });

  it("een gestaag groeiende dagreeks met grote dagwaarden is geen totaalstand", () => {
    expect(isCumulativeSeries(days([100, 150, 210, 260, 330, 400, 460, 520]))).toBe(false);
  });
});
