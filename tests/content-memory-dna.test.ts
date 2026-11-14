import { describe, expect, it } from "vitest";
import { analyzeMemory, type MemoryInput } from "@/server/content-memory/analyze";
import { buildContentDna, dnaPromptText } from "@/server/content-memory/dna";
import type { MemoryStrategy } from "@/server/content-memory/strategy";

const day = (n: number) => new Date(Date.UTC(2026, 5, 1) + n * 86_400_000);
const now = new Date(Date.UTC(2026, 11, 1));

function vid(i: number, opts: Partial<MemoryInput> = {}): MemoryInput {
  return {
    id: `v${i}`, platform: i % 2 ? "instagram" : "tiktok", publishedAt: day(i * 3), caption: `Video nummer ${i} over een mooie woning in Sneek met tuin.\nBel ons gerust voor een bezichtiging.`,
    durationSeconds: 55, views: 1000, likes: 30, comments: 3, shares: 1, saves: 2, avgWatchSeconds: 12, followerDelta: 0,
    externalUrl: null, thumbnail: null, spokenHook: null, planTitle: null, planId: null, format: null, ...opts,
  };
}

const strong: MemoryInput[] = [];
for (let i = 0; i < 12; i++) strong.push(vid(i, { caption: `Wat kost deze woning in Sneek voor €${300 + i}.000?\nLaat het weten in de reacties.`, views: 3000 + i * 100, durationSeconds: 28, avgWatchSeconds: 18, format: "Woningtour met prijsvraag" }));
const weak: MemoryInput[] = [];
for (let i = 12; i < 24; i++) weak.push(vid(i, { format: "Wijkportret", views: 600, likes: 5, comments: 0, shares: 0, saves: 0 }));

const strategy: MemoryStrategy = {
  signature: "x", styles: {}, script: null, scriptBasis: 0, updatedAt: "2026-11-14T07:00:00.000Z", model: null,
  formatIdeas: { "Woningtour met prijsvraag": { format: "Woningtour met prijsvraag", createdAt: "2026-11-14", ideas: [{ name: "Prijs raden duel", description: "Twee woningen naast elkaar, kijker raadt welke duurder is.", why: "Bouwt voort op de prijsvraag.", hook: "Welke van deze twee is duurder?" }] } },
};

describe("content DNA", () => {
  const m = analyzeMemory([...strong, ...weak], now);
  const dna = buildContentDna("Makelaardij Friesland", m, strategy, "2026-11-14T06:00:00.000Z");
  const t = Object.fromEntries(dna.tiles.map((x) => [x.key, x]));

  it("toont de vier onderdelen uit de echte resultaten", () => {
    expect(dna.tiles.map((x) => x.key)).toEqual(["format", "hook", "lengte", "cta"]);
    expect(t.format.value).toBe("Woningtour met prijsvraag");
    expect(t.format.status).toBe("bewezen");
    expect(t.lengte.value).toBe("20 tot 35 sec");
    expect(t.cta.value).toBe("Om een reactie vragen");
  });

  it("zegt eerlijk dat de CTA op engagement rust als er geen conversiedata is", () => {
    expect(t.cta.basis).toBe("engagement");
    expect(t.cta.basisNote).toMatch(/geen conversiedata/);
  });

  it("gebruikt conversiedata als die er wel is", () => {
    const withConv = analyzeMemory([...strong.map((v) => ({ ...v, conversions: 2 })), ...weak], now);
    const d = buildContentDna("X", withConv, null, null);
    expect(d.tiles.find((x) => x.key === "cta")?.basis).toBe("conversies");
  });

  it("schrijft een klantspecifieke conclusie met concreet advies", () => {
    expect(dna.conclusion.text).toMatch(/Makelaardij Friesland/);
    expect(dna.conclusion.text).toMatch(/Woningtour met prijsvraag/);
    expect(dna.conclusion.advice).toMatch(/^Advies voor de volgende drie opnames: plan "Woningtour met prijsvraag" in/);
    expect(dna.conclusion.advice).toMatch(/tussen 20 en 35 seconden/);
    expect(dna.conclusion.text + dna.conclusion.advice).not.toMatch(/[—–]/);
  });

  it("geeft drie aanbevelingen: behouden, testen (variatie op bewezen format) en verbeteren", () => {
    expect(dna.recommendations.behouden?.status).toBe("bewezen");
    expect(dna.recommendations.testen?.source).toBe("voorstel");
    expect(dna.recommendations.testen?.title).toBe("Prijs raden duel");
    expect(dna.recommendations.verbeteren?.title).toMatch(/Wijkportret|stelling|Video's van|zonder duidelijke afsluiting|Bel|Contact/i);
  });

  it("één uitschieter verandert het profiel niet", () => {
    const outlier = vid(99, { format: "Wijkportret", views: 500000, likes: 9000 });
    const d = buildContentDna("X", analyzeMemory([...strong, ...weak, outlier], now), null, null);
    expect(d.tiles.find((x) => x.key === "format")?.value).toBe("Woningtour met prijsvraag");
  });

  it("verzint niets bij te weinig data", () => {
    const d = buildContentDna("X", analyzeMemory(strong.slice(0, 4), now), null, null);
    expect(d.reliability.level).toBe("onvoldoende");
    expect(d.tiles.every((x) => x.status !== "bewezen")).toBe(true);
    expect(d.conclusion.status).not.toBe("bewezen");
    expect(d.conclusion.text).toMatch(/4 geanalyseerde video's/);
    const empty = buildContentDna("X", analyzeMemory([], now), null, null);
    expect(empty.conclusion.status).toBe("onvoldoende");
    expect(empty.recommendations.behouden).toBeNull();
    expect(dnaPromptText(empty)).toBe("");
  });

  it("levert een briefing voor de Script Engine", () => {
    const txt = dnaPromptText(dna);
    expect(txt).toMatch(/CONTENT DNA/);
    expect(txt).toMatch(/Blijven toepassen/);
    expect(txt).toMatch(/Verder testen \(nieuw voorstel, nog niet getest\)/);
  });
});
