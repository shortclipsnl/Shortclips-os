import { describe, expect, it } from "vitest";
import { analyzeMemory, type MemoryInput } from "@/server/content-memory/analyze";
import { buildPlaybook, playbookPromptText } from "@/server/content-memory/playbook";
import type { MemoryStrategy } from "@/server/content-memory/strategy";

const day = (n: number) => new Date(Date.UTC(2026, 5, 1) + n * 86_400_000);
const now = new Date(Date.UTC(2026, 11, 1));

function vid(i: number, opts: Partial<MemoryInput> = {}): MemoryInput {
  return {
    id: `v${i}`, platform: "instagram", publishedAt: day(i * 3), caption: `Video nummer ${i} over een mooie woning in Sneek met tuin.\nBel ons gerust voor een bezichtiging.`,
    durationSeconds: 55, views: 1000, likes: 30, comments: 3, shares: 1, saves: 2, avgWatchSeconds: 12, followerDelta: 0,
    externalUrl: `https://www.instagram.com/reel/ABC${i}/`, thumbnail: null, spokenHook: null, planTitle: null, planId: null, format: null, ...opts,
  };
}

const pubs: MemoryInput[] = [];
for (let i = 0; i < 10; i++) pubs.push(vid(i, { caption: `Wat kost deze woning in Sneek voor €${300 + i}.000?\nBekijk de link in bio.`, views: 3000 + i * 100, durationSeconds: 28, avgWatchSeconds: 18, format: "Woningtour met prijsvraag" }));
for (let i = 10; i < 22; i++) pubs.push(vid(i, { format: "Wijkportret" }));
const m = analyzeMemory(pubs, now);

const strategy: MemoryStrategy = {
  signature: "x",
  styles: Object.fromEntries(pubs.map((p, i) => [p.id, i < 10 ? "Rondleiding" : "Presentator in beeld"])) as MemoryStrategy["styles"],
  formatIdeas: {},
  script: { opening: "Prijsvraag in de eerste seconde.", informatie: "Drie kenmerken.", tempo: "Korte zinnen.", spanning: "Prijs pas aan het einde.", cta: "Link in bio." },
  scriptBasis: 12,
  updatedAt: "2026-11-14T07:00:00.000Z",
  model: null,
};

describe("contentgeheugen: wat werkt voor deze klant", () => {
  it("bepaalt format, hook, lengte en filmstijl uit de echte resultaten", () => {
    const p = buildPlaybook(m, strategy);
    const by = Object.fromEntries(p.items.map((i) => [i.key, i]));
    expect(by.format.value).toBe("Woningtour met prijsvraag");
    expect(by.format.status).toBe("bewezen");
    expect(["Prijs direct in de hook", "Openen met een vraag"]).toContain(by.hook.value);
    expect(by.hook.quote).toMatch(/Wat kost deze woning/);
    expect(by.lengte.value).toBe("20 tot 35 sec");
    expect(by.filmstijl.value).toBe("Rondleiding");
    expect(by.filmstijl.metrics.some((x) => x.label === "Retentie")).toBe(true);
  });

  it("noemt de scriptopbouw nooit bewezen", () => {
    const p = buildPlaybook(m, strategy);
    expect(p.items.find((i) => i.key === "script")!.status).toBe("indicatie");
    expect(p.recipe.map((r) => r.key)).not.toContain("script");
  });

  it("trekt geen conclusies bij te weinig data", () => {
    const p = buildPlaybook(analyzeMemory(pubs.slice(0, 5), now), strategy);
    expect(p.recipe).toEqual([]);
    expect(p.items.every((i) => i.status === "onvoldoende")).toBe(true);
  });

  it("zonder strategie geen verzonnen filmstijl", () => {
    const p = buildPlaybook(m, null);
    const f = p.items.find((i) => i.key === "filmstijl")!;
    expect(f.value).toBeNull();
    expect(f.status).toBe("onvoldoende");
    expect(playbookPromptText(p)).toContain("WAT WERKT VOOR DEZE KLANT");
  });
});
