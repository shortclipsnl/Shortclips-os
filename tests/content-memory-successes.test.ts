import { describe, expect, it } from "vitest";
import { analyzeMemory, videoEmbedUrl, type MemoryInput } from "@/server/content-memory/analyze";

const day = (n: number) => new Date(Date.UTC(2026, 5, 1) + n * 86_400_000);

function vid(i: number, opts: Partial<MemoryInput> = {}): MemoryInput {
  return {
    id: `v${i}`, platform: "instagram", publishedAt: day(i * 3), caption: `Video nummer ${i} over een mooie woning in Sneek met tuin.\nBel ons gerust voor een bezichtiging.`,
    durationSeconds: 30, views: 1000, likes: 30, comments: 3, shares: 1, saves: 2, avgWatchSeconds: 10, followerDelta: 0,
    externalUrl: `https://www.instagram.com/reel/ABC${i}/`, thumbnail: null, spokenHook: null, planTitle: null, planId: null, format: null, ...opts,
  };
}

describe("contentgeheugen: successen gekoppeld aan video's", () => {
  const pubs: MemoryInput[] = [];
  for (let i = 0; i < 10; i++) pubs.push(vid(i, { caption: `Wat kost deze woning in Sneek voor €${300 + i}.000?\nBekijk de link in bio.`, views: 3000 + i * 100, format: "Woningtour met prijsvraag" }));
  for (let i = 10; i < 22; i++) pubs.push(vid(i, { format: "Wijkportret" }));
  const m = analyzeMemory(pubs, new Date(Date.UTC(2026, 11, 1)));

  it("levert successen met titel, bewijs en de video's die het dragen", () => {
    expect(m.sufficient).toBe(true);
    expect(m.successes.length).toBeGreaterThan(0);
    const prijs = m.successes.find((s) => s.title === "Prijs in de hook");
    expect(prijs).toBeDefined();
    expect(prijs!.videos.length).toBeGreaterThan(0);
    expect(prijs!.videos.every((v) => v.hookTypes.includes("Prijs"))).toBe(true);
    expect(["aannemelijk", "sterk"]).toContain(prijs!.evidence);
  });

  it("geeft elke video een afspeelbare embed en interactiecijfers", () => {
    const v = m.topVideos[0];
    expect(v.embedUrl).toMatch(/instagram\.com\/reel\/ABC\d+\/embed\//);
    expect(v.likes).toBeGreaterThan(0);
  });

  it("toont geen successen bij te weinig data", () => {
    const small = analyzeMemory(pubs.slice(0, 5), new Date(Date.UTC(2026, 11, 1)));
    expect(small.sufficient).toBe(false);
    expect(small.successes).toEqual([]);
  });

  it("ondersteunt YouTube Shorts in de speler", () => {
    expect(videoEmbedUrl("youtube", "https://www.youtube.com/shorts/abcDEF12345")).toContain("youtube.com/embed/abcDEF12345");
  });
});
