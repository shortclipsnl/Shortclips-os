import { describe, expect, it } from "vitest";
import { analyzePerformance, classifyCta, classifyHook, hookLine, insightsToPromptText, isVideo, type PubInput } from "@/server/scripts/performance-analysis";

const NOW = new Date("2026-11-12T12:00:00Z");
let n = 0;
function pub(over: Partial<PubInput>): PubInput {
  n++;
  return {
    id: `p${n}`, platform: "instagram", publishedAt: new Date("2026-10-01T10:00:00Z"), caption: "Video",
    durationSeconds: 30, views: 1000, likes: 10, comments: 1, shares: 1, saves: 1,
    watchTimeSeconds: 100, avgWatchSeconds: 10, completionRate: 0.3, firstMeasuredOn: "2026-11-02", ...over,
  };
}

describe("captionherkenning", () => {
  it("pakt de openingszin als hook en slaat labelregels en contactregels over", () => {
    expect(hookLine("UITGELICHT ✨\nWat betaal je in Leeuwarden voor een appartement? Kijk mee\n📍 Adres")).toBe("Wat betaal je in Leeuwarden voor een appartement?");
    expect(hookLine("𝗚𝗲𝘄𝗼𝗼𝗻 𝘁𝗵𝘂𝗶𝘀𝗸𝗼𝗺𝗲𝗻 is fijn.\nMeer")).toBe("Gewoon thuiskomen is fijn.");
  });
  it("herkent hooktypes en CTA's", () => {
    expect(classifyHook("45.000 euro VOOR een AUDI RS5?!")).toEqual(expect.arrayContaining(["vraag", "prijs of getal", "nadruk in hoofdletters"]));
    expect(classifyCta("Kies hieronder in de poll! ⤵️")).toBe("poll");
    expect(classifyCta("Laat het weten in de comments")).toBe("reactie vragen");
    expect(classifyCta("📞| 0521 588 489")).toBe("geen duidelijke CTA");
  });
});

describe("analyzePerformance", () => {
  it("filtert niet-video's (zoals aanbodposts zonder kijktijd)", () => {
    const fotopost = pub({ platform: "facebook", durationSeconds: null, avgWatchSeconds: null, completionRate: null, watchTimeSeconds: 0, views: 108000 });
    expect(isVideo(fotopost)).toBe(false);
    const ins = analyzePerformance([fotopost, ...Array.from({ length: 8 }, () => pub({}))], NOW);
    expect(ins.excludedNonVideo).toBe(1);
    expect(ins.top.every((t) => t.views < 108000)).toBe(true);
  });

  it("concludeert niets bij te weinig data", () => {
    const ins = analyzePerformance([pub({}), pub({})], NOW);
    expect(ins.sufficient).toBe(false);
    expect(insightsToPromptText(ins)).toContain("Onvoldoende data");
  });

  it("vergelijkt per platform en vindt de CTA die beter werkt", () => {
    const pubs = [
      ...Array.from({ length: 4 }, () => pub({ caption: "Wat vind jij? Laat het weten in de comments", views: 4000, avgWatchSeconds: 15 })),
      ...Array.from({ length: 6 }, () => pub({ caption: "Mooie auto.", views: 1000 })),
      // TikTok heeft een eigen niveau: telt niet als 'slecht' t.o.v. Instagram.
      ...Array.from({ length: 3 }, () => pub({ platform: "tiktok", caption: "Mooie auto.", views: 200 })),
    ];
    const ins = analyzePerformance(pubs, NOW);
    expect(ins.sufficient).toBe(true);
    const reactie = ins.groups.find((g) => g.dimension === "cta" && g.label === "reactie vragen");
    expect(reactie?.verdict).toBe("beter");
    expect(ins.findings.join("\n")).toMatch(/KIJKTIJD OMHOOG/);
    expect(ins.platforms.find((p) => p.platform === "tiktok")?.medianViews).toBe(200);
  });

  it("laat te jonge video's buiten de analyse", () => {
    const ins = analyzePerformance([...Array.from({ length: 8 }, () => pub({})), pub({ publishedAt: new Date("2026-11-11T10:00:00Z") })], NOW);
    expect(ins.excludedTooYoung).toBe(1);
  });
});
