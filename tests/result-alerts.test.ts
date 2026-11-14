import { describe, expect, it } from "vitest";
import { analyzeClient, measureEffect, type AlertInput, type AlertVideo } from "@/lib/result-alerts";

const NOW = new Date("2026-11-14T08:00:00Z");

/** n video's op één platform, nieuwste eerst, om de 3 dagen; scores per index. */
function vids(platform: string, scores: number[], opts: Partial<AlertVideo> = {}, startDaysAgo = 8): AlertVideo[] {
  return scores.map((s, i) => {
    const d = new Date(NOW.getTime() - (startDaysAgo + i * 3) * 86_400_000).toISOString().slice(0, 10);
    return {
      id: `${platform}-${i}`,
      platform,
      publishedOn: d,
      title: `Video ${i}`,
      hook: `Wist je dat dit de hook van video ${i} is?`,
      hookTypes: ["Vraag"],
      cta: "Reactie vragen",
      ctaText: null,
      format: null,
      durationSeconds: 30,
      views: Math.round(1000 * s),
      interactions: Math.round(50 * s),
      retention: 0.5,
      viewScore: s,
      engScore: 1,
      perf: 0.6 * s + 0.4,
      ...opts,
    };
  });
}

const base = (videos: AlertVideo[], extra: Partial<AlertInput> = {}): AlertInput => ({
  videos,
  formats: [],
  hooks: [],
  ctas: [],
  lengths: [],
  followers: null,
  posts: { cur: 8, prev: 8 },
  publicationCount: videos.length,
  now: NOW,
  ...extra,
});

describe("Klanten die aandacht nodig hebben: analyse", () => {
  it("geeft onvoldoende data bij te weinig video's", () => {
    const r = analyzeClient(base(vids("instagram", [1, 1, 1, 1, 1])));
    expect(r.status).toBe("onvoldoende");
  });

  it("geeft geen alert bij één tegenvallende video", () => {
    const r = analyzeClient(base(vids("instagram", [0.3, 1.1, 1, 0.9, 1, 1.2, 1, 0.9, 1.1, 1, 1, 1])));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.negative).toBeNull();
  });

  it("geeft rood bij een structurele daling van het bereik", () => {
    const r = analyzeClient(base(vids("instagram", [0.4, 0.5, 0.45, 0.5, 1, 1.1, 0.9, 1, 1.2, 1, 1, 1])));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.negative?.level).toBe("rood");
    expect(r.negative?.headline).toMatch(/Bereik daalt met \d+%/);
    expect(r.negative?.causes.length).toBeGreaterThan(0);
    expect(r.negative?.actions.length).toBeGreaterThan(2);
  });

  it("geeft oranje bij een matige daling", () => {
    const r = analyzeClient(base(vids("instagram", [0.7, 0.7, 0.75, 0.72, 1, 1.05, 0.95, 1, 1, 1, 1, 1])));
    if (r.status !== "ok") throw new Error("verwacht ok");
    expect(r.negative?.level).toBe("oranje");
  });

  it("onderbouwt de oorzaak met retentie als kijkers eerder afhaken", () => {
    const recent = vids("instagram", [0.5, 0.5, 0.5, 0.5], { retention: 0.25 });
    const older = vids("instagram", [1, 1, 1, 1, 1, 1, 1, 1], { retention: 0.5 }, 20);
    const r = analyzeClient(base([...recent, ...older].map((v, i) => ({ ...v, id: `v${i}` }))));
    if (r.status !== "ok") throw new Error("verwacht ok");
    expect(r.negative?.findings.some((f) => f.key === "retentie")).toBe(true);
    expect(r.negative?.causes[0].kind).toBe("onderbouwd");
  });

  it("geeft groen bij duidelijke groei", () => {
    const r = analyzeClient(base(vids("tiktok", [2, 1.8, 2.2, 1.9, 1, 1, 1, 1, 1, 1, 1, 1])));
    if (r.status !== "ok") throw new Error("verwacht ok");
    expect(r.positive?.level).toBe("groen");
    expect(r.negative).toBeNull();
  });

  it("negeert platforms zonder recente video's", () => {
    const r = analyzeClient(base(vids("instagram", [0.4, 0.4, 0.4, 0.4, 1, 1, 1, 1, 1, 1, 1, 1], {}, 80)));
    expect(r.status).toBe("onvoldoende");
  });
});

describe("effectmeting", () => {
  it("wacht tot er genoeg nieuwe video's zijn en meet dan de verbetering", () => {
    const snap = { measuredAt: NOW.toISOString(), platforms: [{ platform: "instagram", viewScoreRecent: 0.5, viewScoreBase: 1, engScoreRecent: 1, engScoreBase: 1, retentionRecent: 0.3, retentionBase: 0.5, medianViewsRecent: 500, medianViewsBase: 1000, recentTo: "2026-10-01" }] };
    const action = new Date("2026-10-20T10:00:00Z");
    const two = vids("instagram", [1, 1], {}, 8);
    expect(measureEffect(two, snap, ["instagram"], action, NOW).status).toBe("wachten");
    const three = vids("instagram", [1, 0.9, 1.1], {}, 8);
    const e = measureEffect(three, snap, ["instagram"], action, NOW);
    expect(e.status).toBe("gemeten");
    expect(e.verdict).toBe("verbeterd");
    expect(e.changePct).toBe(100);
  });
});
