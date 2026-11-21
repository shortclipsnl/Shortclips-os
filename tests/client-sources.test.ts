import { describe, expect, it } from "vitest";
import { analysePosts, captionOpening, postAnalysisToText, type PostRow } from "@/server/content-research/post-performance";

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

describe("Klantstatistieken (alleen video's)", () => {
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

describe("Geldige tekst naar de AI", () => {
  it("knipt geen emoji doormidden", () => {
    const caption = `${"a".repeat(116)}🤩🤩 rest`;
    const out = captionOpening(caption);
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
    expect(out).toBe(`${"a".repeat(116)}🤩...`);
  });
  it("verwijdert losse surrogaten", async () => {
    const { wellFormed } = await import("@/server/content-research/style-ai");
    const broken = "ok \uD83E einde";
    expect(wellFormed(broken)).toBe("ok  einde");
    expect(wellFormed("emoji 🤩 blijft")).toBe("emoji 🤩 blijft");
  });
});
