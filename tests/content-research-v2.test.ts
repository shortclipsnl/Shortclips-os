import { describe, expect, it } from "vitest";
import { analysePosts, captionOpening, postAnalysisToText, type PostRow } from "@/server/content-research/post-performance";
import { dataShare, normalizeOpportunity, opportunityTotal, rankWithVariety } from "@/server/content-research/opportunity";

function post(i: number, platform: string, views: number, extra: Partial<PostRow> = {}): PostRow {
  return {
    publicationId: `p${i}`,
    platform,
    publishedAt: new Date(2026, 9, 1 + i),
    caption: `Openingszin ${i}\nRest van de caption`,
    url: `https://example.com/${i}`,
    views,
    likes: Math.round(views * 0.05),
    comments: 2,
    shares: 1,
    saves: 1,
    completionRate: null,
    avgWatchSeconds: null,
    ...extra,
  };
}

describe("Content Research: eigen statistieken", () => {
  it("geeft geen data terug als er geen weergaven zijn", () => {
    const a = analysePosts([post(1, "tiktok", 0)]);
    expect(a.posts).toBe(0);
    expect(a.zekerheid).toBe("geen data");
    expect(postAnalysisToText(a)).toBe("");
  });

  it("vergelijkt relatief met de mediaan van hetzelfde platform", () => {
    // TikTok-mediaan 1000, Instagram-mediaan 100: een Instagram-post met 400 is
    // relatief sterker dan een TikTok-post met 1500.
    const rows = [
      post(1, "tiktok", 900), post(2, "tiktok", 1000), post(3, "tiktok", 1100), post(4, "tiktok", 1500),
      post(5, "instagram", 90), post(6, "instagram", 100), post(7, "instagram", 110), post(8, "instagram", 400),
    ];
    const a = analysePosts(rows);
    expect(a.platforms.find((p) => p.platform === "instagram")!.medianViews).toBe(105);
    expect(a.top[0]!.publicationId).toBe("p8");
    expect(a.top[0]!.relatief).toBeGreaterThan(3);
    expect(a.top.map((p) => p.publicationId)).not.toContain("p4"); // 1,4x: geen uitschieter
  });

  it("laat platforms met minder dan 3 posts buiten top en zwak", () => {
    const a = analysePosts([post(1, "youtube", 10), post(2, "youtube", 10000)]);
    expect(a.top).toHaveLength(0);
    expect(a.zwak).toHaveLength(0);
    expect(a.zekerheid).toBe("indicatie");
  });

  it("noemt de captionopening expliciet geen gesproken hook", () => {
    const rows = [post(1, "tiktok", 100), post(2, "tiktok", 100), post(3, "tiktok", 900)];
    const text = postAnalysisToText(analysePosts(rows));
    expect(text).toContain("NIET per se de gesproken hook");
    expect(text).toContain("Openingszin 3");
  });

  it("knipt de captionopening netjes af", () => {
    expect(captionOpening("\n\n  Eerste regel  \ntweede")).toBe("Eerste regel");
    expect(captionOpening("x".repeat(200)).length).toBe(120);
    expect(captionOpening(null)).toBe("");
  });
});

describe("Content Research: Opportunity Score", () => {
  const raw = {
    relevantie: { score: 8, basis: "data" },
    eerdereResultaten: { score: 9, basis: "data" },
    concurrentie: { score: 7, basis: "data" },
    originaliteit: { score: 6, basis: "data" },
    doelaansluiting: { score: 8 },
    uitvoerbaarheid: { score: 10, basis: "inschatting" },
  };

  it("accepteert 'data' alleen waar die data echt bestaat", () => {
    const o = normalizeOpportunity(raw, { hasPostData: true, hasCompetitorSources: true });
    expect(o.eerdereResultaten.basis).toBe("data");
    expect(o.concurrentie.basis).toBe("data");
    expect(o.relevantie.basis).toBe("inschatting");
    expect(o.originaliteit.basis).toBe("inschatting");
  });

  it("zonder eigen statistieken: geen data-claim en max. 5 op eerdere resultaten", () => {
    const o = normalizeOpportunity(raw, { hasPostData: false, hasCompetitorSources: false });
    expect(o.eerdereResultaten.basis).toBe("inschatting");
    expect(o.eerdereResultaten.score).toBe(5);
    expect(o.concurrentie.basis).toBe("inschatting");
    expect(dataShare(o)).toBe(0);
  });

  it("rekent een gewogen totaal van 0 tot 100", () => {
    const all10 = normalizeOpportunity(
      Object.fromEntries(Object.keys(raw).map((k) => [k, { score: 10 }])),
      { hasPostData: true, hasCompetitorSources: true },
    );
    expect(opportunityTotal(all10)).toBe(100);
    const o = normalizeOpportunity(raw, { hasPostData: true, hasCompetitorSources: true });
    // (8*20 + 9*20 + 7*15 + 6*15 + 8*15 + 10*15) / 1000 = 805/1000
    expect(opportunityTotal(o)).toBe(81);
  });

  it("vangt rommel van het model op", () => {
    const o = normalizeOpportunity({ relevantie: { score: "veel" }, uitvoerbaarheid: { score: 42 } }, { hasPostData: true, hasCompetitorSources: true }, 6);
    expect(o.relevantie.score).toBe(5);
    expect(o.uitvoerbaarheid.score).toBe(10);
    expect(o.originaliteit.score).toBe(6);
  });
});

describe("Content Research: rangorde met variatie", () => {
  it("houdt de top gevarieerd", () => {
    const items = [
      { id: "a", opportunityScore: 90, categorie: "humor" },
      { id: "b", opportunityScore: 88, categorie: "humor" },
      { id: "c", opportunityScore: 86, categorie: "humor" },
      { id: "d", opportunityScore: 80, categorie: "educatief" },
    ];
    const ranked = rankWithVariety(items).map((i) => i.id);
    expect(ranked[0]).toBe("a");
    // 88*0,88 = 77,4 < 80: het educatieve idee komt vóór de tweede humorvariant.
    expect(ranked[1]).toBe("d");
    expect(ranked).toHaveLength(4);
  });
});

describe("Content Research: geldige tekst naar de AI", () => {
  it("knipt geen emoji doormidden", () => {
    const caption = `${"a".repeat(116)}🤩🤩 rest`;
    const out = captionOpening(caption);
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
    expect(out).toBe(`${"a".repeat(116)}🤩...`);
  });
  it("verwijdert losse surrogaten", async () => {
    const { wellFormed } = await import("@/server/content-research/generate");
    const broken = "ok \uD83E einde";
    expect(wellFormed(broken)).toBe("ok  einde");
    expect(wellFormed("emoji 🤩 blijft")).toBe("emoji 🤩 blijft");
  });
});
