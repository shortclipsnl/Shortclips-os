import { describe, expect, it } from "vitest";
import { buildHighlights } from "@/app/(portal)/portal/resultaten/highlights";
import type { PortalResults } from "@/server/portal";

const plat = (platform: string, state: "data" | "stil" | "niet-gekoppeld", views: number | null, g: number | null) => ({
  platform, state, views, viewsFrom: "kanaal" as const, reach: null, likes: null, comments: null, shares: null, interactions: null,
  engagementRate: null, followerGrowth: null, videoCount: 0, growth: { views: g, interactions: null, followerGrowth: null }, prev: { views: null, interactions: null, followerGrowth: null },
});

function base(over: Partial<PortalResults> = {}): PortalResults {
  return {
    days: 31, periodKey: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-31", prevStart: "2026-09-01", prevEnd: "2026-09-30", firstDataOn: null,
    metrics: { views: 1000, reach: 500, engagements: 0, followerGrowth: 0, publishedVideos: 4 },
    prev: { views: 1000, reach: 500, engagements: 0, followerGrowth: 0, publishedVideos: 4 },
    deltas: { views: null, reach: null, engagements: null, followerGrowth: null, publishedVideos: null },
    byPlatform: [], platforms: [], series: [], seriesByPlatform: {}, topVideos: [], allVideos: [], videos: [],
    likes: 0, comments: 0, valuableInteractions: 0, avgWatchSeconds: 0, insight: null, insights: [], milestone: null,
    lastUpdated: null, hasData: true, plannedPlatforms: [], ...over,
  } as PortalResults;
}

describe("Wat valt op", () => {
  it("toont niets zonder cijfers", () => {
    expect(buildHighlights(base({ hasData: false }))).toEqual([]);
  });

  it("noemt geen groei of daling zonder vergelijkbare data", () => {
    const h = buildHighlights(base());
    expect(h.some((x) => x.tone === "aandacht")).toBe(false);
    expect(h.some((x) => x.figure.includes("%"))).toBe(false);
  });

  it("groei is groen, daling oranje, successen eerst", () => {
    const h = buildHighlights(base({
      deltas: { views: 30, reach: -12, engagements: null, followerGrowth: null, publishedVideos: null },
      platforms: [plat("instagram", "data", 800, 25), plat("tiktok", "data", 200, -40), plat("youtube", "stil", null, null), plat("facebook", "niet-gekoppeld", null, null)] as PortalResults["platforms"],
    }));
    expect(h[0]).toMatchObject({ tone: "positief", figure: "+30% weergaven" });
    expect(h.find((x) => x.figure === "-12% bereik")?.tone).toBe("aandacht");
    expect(h.find((x) => x.figure === "TikTok -40%")?.tone).toBe("aandacht");
    expect(h.find((x) => x.figure.startsWith("Geen activiteit op YouTube"))?.tone).toBe("aandacht");
    // Een niet-gekoppeld kanaal levert geen verzonnen punt op.
    expect(h.some((x) => x.figure.includes("Facebook"))).toBe(false);
    const firstAtt = h.findIndex((x) => x.tone === "aandacht");
    expect(h.slice(firstAtt).every((x) => x.tone === "aandacht")).toBe(true);
  });
});
