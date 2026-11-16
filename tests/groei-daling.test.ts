import { describe, expect, it } from "vitest";
import { classify, minVolume, signalsOf, type TrendInput } from "@/lib/groei-daling";

const none = { cur: null, prev: null, curN: 0, prevN: 0 };
function client(over: Partial<TrendInput>): TrendInput {
  return {
    clientId: over.clientId ?? "c1", name: over.name ?? "Klant", slug: "klant", color: null, logoUrl: null,
    goal: null, days: 30, measureDays: 30, measureDaysPrev: 30,
    views: 10_000, viewsPrev: 10_000, reach: 0, reachPrev: 0, followers: 0, followersPrev: 0,
    retention: none, engagement: none, videos: 8, videosPrev: 8, topHook: null,
    ...over,
  };
}

describe("groei en daling per klant", () => {
  it("daling in weergaven met voldoende basis", () => {
    const r = classify([client({ views: 5000, viewsPrev: 10_000 })]);
    expect(r.daling).toHaveLength(1);
    expect(r.daling[0]!.main.kpi).toBe("weergaven");
    expect(r.daling[0]!.main.delta).toBe(-50);
    expect(r.daling[0]!.urgency).toBe("hoog");
  });

  it("geen waarschuwing bij een te kleine basis", () => {
    const r = classify([client({ views: 100, viewsPrev: 400 })]);
    expect(r.daling).toHaveLength(0);
    expect(r.onvoldoende[0]!.reason).toContain("te weinig weergaven");
  });

  it("onvolledige metingen tellen niet als daling", () => {
    const r = classify([client({ views: 2000, viewsPrev: 10_000, measureDays: 8, measureDaysPrev: 30 })]);
    expect(r.daling).toHaveLength(0);
    expect(r.onvoldoende[0]!.reason).toContain("onvolledig");
  });

  it("minimale basis schaalt mee met de periode", () => {
    expect(minVolume(7)).toBe(1000);
    expect(minVolume(90)).toBe(9000);
  });

  it("dalende doel-KPI wint van groeiende weergaven", () => {
    const r = classify([client({ goal: "volgers", views: 20_000, viewsPrev: 10_000, followers: 20, followersPrev: 100 })]);
    expect(r.daling).toHaveLength(1);
    expect(r.daling[0]!.main.kpi).toBe("volgers");
    expect(r.daling[0]!.main.goal).toBe(true);
  });

  it("minder video's gepubliceerd wordt benoemd als aantoonbare oorzaak", () => {
    const r = classify([client({ views: 6000, viewsPrev: 10_000, videos: 3, videosPrev: 8 })]);
    expect(r.daling[0]!.note).toContain("8 → 3 video's");
    expect(r.daling[0]!.action).toContain("Publicatieritme");
  });

  it("groei sorteert op relevantie en betrouwbaarheid, niet alleen percentage", () => {
    const klein = client({ clientId: "a", name: "Klein", views: 12_000, viewsPrev: 3000 }); // +300% op kleine basis
    const groot = client({ clientId: "b", name: "Groot", goal: "bereik", views: 180_000, viewsPrev: 100_000, reach: 150_000, reachPrev: 80_000 });
    const r = classify([klein, groot]);
    expect(r.groei.map((g) => g.name)).toEqual(["Groot", "Klein"]);
  });

  it("toont wat goed gaat alleen als het uit de data blijkt", () => {
    const met = classify([client({ views: 20_000, topHook: { hook: "Wist je dit?", score: 3.2 } })]).groei[0]!;
    expect(met.works).toContain("Wist je dit?");
    const zonder = classify([client({ views: 20_000 })]).groei[0]!;
    expect(zonder.works).toBeNull();
  });

  it("kijktijd telt pas mee vanaf drie video's per periode", () => {
    expect(signalsOf(client({ retention: { cur: 0.2, prev: 0.4, curN: 2, prevN: 5 } })).some((s) => s.kpi === "kijktijd")).toBe(false);
    expect(signalsOf(client({ retention: { cur: 0.2, prev: 0.4, curN: 3, prevN: 5 } })).some((s) => s.kpi === "kijktijd")).toBe(true);
  });

  it("stabiele klant staat in geen van beide kolommen", () => {
    const r = classify([client({ views: 10_500 })]);
    expect(r.daling).toHaveLength(0);
    expect(r.groei).toHaveLength(0);
    expect(r.onvoldoende).toHaveLength(0);
  });
});
