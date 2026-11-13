import { describe, expect, it } from "vitest";
import * as lib from "@/lib/resultaten-overzicht";
import {
  deltaPct, embedUrl, isVideoPost, rankVideos, resolvePeriod, videoCards, type PostRow,
} from "@/lib/resultaten-overzicht";

const post = (o: Partial<PostRow>): PostRow => ({
  id: "x", clientId: "c1", clientName: "Klant", clientSlug: "klant", clientColor: null, clientLogoUrl: null,
  platform: "instagram", url: "https://www.instagram.com/reel/ABC/", caption: "Hallo wereld",
  publishedAt: "2026-11-05T10:00:00.000Z", durationSeconds: 20, thumb: null,
  views: 100, reach: 80, likes: 10, comments: 2, shares: 1, saves: 3, ...o,
});

describe("resultatenoverzicht", () => {
  it("rekent periodes in Nederlandse kalenderdagen", () => {
    const p30 = resolvePeriod("30", "2026-11-11");
    expect(p30).toMatchObject({ from: "2026-10-12", to: "2026-11-12", prevFrom: "2026-09-12", prevTo: "2026-10-12" });
    const m = resolvePeriod("maand", "2026-11-11");
    expect(m).toMatchObject({ from: "2026-11-01", to: "2026-11-12", prevFrom: "2026-10-21", prevTo: "2026-11-01", days: 11 });
    const vm = resolvePeriod("vorigemaand", "2026-01-15");
    expect(vm).toMatchObject({ from: "2025-12-01", to: "2026-01-01", prevFrom: "2025-11-01", prevTo: "2025-12-01" });
  });

  it("geeft geen percentage zonder eerlijke basis", () => {
    expect(deltaPct(10, 0)).toBeNull();
    expect(deltaPct(150, 100)).toBe(50);
  });

  it("herkent alleen video's", () => {
    expect(isVideoPost({ platform: "instagram", url: "https://www.instagram.com/p/X/", durationSeconds: null })).toBe(false);
    expect(isVideoPost({ platform: "facebook", url: "https://facebook.com/1/posts/2", durationSeconds: 15 })).toBe(true);
    expect(isVideoPost({ platform: "tiktok", url: "https://www.tiktok.com/@a/video/123", durationSeconds: null })).toBe(true);
  });

  it("voegt crossposts samen en telt ze niet dubbel", () => {
    const cards = videoCards([
      post({ id: "ig", views: 500 }),
      post({ id: "fb", platform: "facebook", url: "https://facebook.com/1/videos/2", views: 200 }),
      post({ id: "ander", caption: "Iets anders", views: 300 }),
    ]);
    expect(cards.map((c) => c.id).sort()).toEqual(["ander", "ig"]);
    expect(cards.find((c) => c.id === "ig")?.alsoOn).toEqual(["facebook"]);
  });

  it("toont niet-beschikbare cijfers als null en rangschikt", () => {
    const cards = videoCards([
      post({ id: "a", views: 100, likes: 50, caption: "a" }),
      post({ id: "b", platform: "tiktok", url: "https://www.tiktok.com/@x/video/9", reach: 0, saves: 0, views: 900, caption: "b" }),
    ]);
    const b = cards.find((c) => c.id === "b")!;
    expect(b.reachValue).toBeNull();
    expect(b.savesValue).toBeNull();
    expect(rankVideos(cards, "views").map((c) => c.id)).toEqual(["b", "a"]);
    expect(rankVideos(cards, "reach").map((c) => c.id)).toEqual(["a"]);
  });

  it("maakt afspeelbare embed-links", () => {
    expect(embedUrl("instagram", "https://www.instagram.com/reel/DeuDnuIgfbo/")).toBe("https://www.instagram.com/reel/DeuDnuIgfbo/embed/");
    expect(embedUrl("tiktok", "https://www.tiktok.com/@h/video/7693925885312863521?utm=1")).toContain("/player/v1/7693925885312863521");
  });
});

describe("resultatenoverzicht: categorieën", () => {
  const mk = (o: Partial<PostRow>) => lib.toCard(post(o));

  it("rekent retentie uit kijktijd en lengte, anders uit wat het platform levert", () => {
    expect(lib.retentionOf({ avgWatchSeconds: 10, durationSeconds: 20, completionRate: null })).toBe(0.5);
    expect(lib.retentionOf({ avgWatchSeconds: null, durationSeconds: 20, completionRate: 0.3 })).toBe(0.3);
    expect(lib.retentionOf({ avgWatchSeconds: null, durationSeconds: null, completionRate: null })).toBeNull();
  });

  it("geeft geen engagementpercentage bij te weinig weergaven", () => {
    expect(mk({ views: 100 }).engagementRate).toBeNull();
    expect(mk({ views: 1000, likes: 50, comments: 0, shares: 0, saves: 0 }).engagementRate).toBe(0.05);
  });

  it("toont in een categorie alleen video's met dat cijfer", () => {
    const cards = [
      mk({ id: "a", views: 5000, avgWatchSeconds: 8 }),
      mk({ id: "b", views: 9000, avgWatchSeconds: null }),
      mk({ id: "c", views: 700, avgWatchSeconds: 12 }),
    ];
    expect(lib.rankByCategory(cards, "kijktijd").map((c) => c.id)).toEqual(["c", "a"]);
    expect(lib.rankByCategory(cards, "weergaven").map((c) => c.id)).toEqual(["b", "a", "c"]);
  });

  it("meet een hook tegen het normale niveau van de klant op dat platform", () => {
    const cards = lib.scoreCards(
      [
        mk({ id: "a", views: 3000, hook: "Wist je dit?" }),
        mk({ id: "b", views: 3000, hook: null }),
        mk({ id: "c", views: 200, hook: "Te weinig weergaven" }),
      ],
      new Map([[lib.baselineKey("c1", "instagram"), 1000]]),
    );
    expect(cards.find((c) => c.id === "a")?.hookScore).toBe(3);
    expect(cards.find((c) => c.id === "b")?.hookScore).toBeNull();
    expect(cards.find((c) => c.id === "c")?.hookScore).toBeNull();
    expect(lib.rankByCategory(cards, "hooks").map((c) => c.id)).toEqual(["a"]);
  });

  it("geeft een totaalscore tussen 0 en 100", () => {
    const cards = lib.scoreCards([1, 2, 3, 4].map((i) => mk({ id: String(i), views: i * 1000 })), new Map());
    const scores = cards.map((c) => c.totalScore ?? -1);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...scores)).toBeLessThanOrEqual(100);
    expect(lib.rankByCategory(cards, "totaal")[0].id).toBe("4");
  });
});
