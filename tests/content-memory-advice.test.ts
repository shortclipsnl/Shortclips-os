import { describe, expect, it } from "vitest";
import { analyzeMemory, type MemoryInput } from "@/server/content-memory/analyze";
import { advicePromptText, buildAdvice, ctaGoalOf, holdScores, measureAdvice, provenPatterns } from "@/server/content-memory/advice";

const day = (n: number) => new Date(Date.UTC(2026, 5, 1) + n * 86_400_000);
const now = new Date(Date.UTC(2026, 11, 1));

function vid(i: number, opts: Partial<MemoryInput> = {}): MemoryInput {
  return {
    id: `v${i}`, platform: "instagram", publishedAt: day(i * 3), caption: `Video nummer ${i} over een mooie woning in Sneek met tuin.\nBel ons gerust voor een bezichtiging.`,
    durationSeconds: 55, views: 1000, likes: 30, comments: 3, shares: 1, saves: 2, avgWatchSeconds: 12, followerDelta: 0,
    externalUrl: `https://example.com/${i}`, thumbnail: null, spokenHook: null, planTitle: null, planId: null, format: null, ...opts,
  };
}

// Eerst 12 gewone video's, daarna 6 sterke met prijsvraag: bewezen, maar nog weinig ingezet in het totaal.
const normal: MemoryInput[] = [];
for (let i = 0; i < 14; i++) normal.push(vid(i, { format: "Wijkportret", views: 900 + (i % 3) * 100 }));
const strong: MemoryInput[] = [];
for (let i = 14; i < 20; i++) strong.push(vid(i, { publishedAt: day(i), caption: `Wat kost deze woning in Sneek voor €${300 + i}.000?\nLaat het weten in de reacties.`, views: 3200 + i * 50, comments: 40, durationSeconds: 55, avgWatchSeconds: 30, format: "Woningtour met prijsvraag" }));
const weak: MemoryInput[] = [];
for (let i = 20; i < 26; i++) weak.push(vid(i, { publishedAt: day(i - 10), caption: `Dit is ons team op kantoor vandaag, nummer ${i}.\nVolg ons voor meer.`, views: 300, likes: 3, comments: 0, shares: 0, saves: 0, format: "Teamvideo" }));

const m = analyzeMemory([...normal, ...strong, ...weak], now);
const structures = Object.fromEntries([...strong.map((v) => [v.id, "Rondleiding"]), ...normal.map((v) => [v.id, "Sfeerimpressie"])]);

describe("contentadvies", () => {
  const a = buildAdvice(m, { structures });
  const keys = (xs: Array<{ key: string }>) => xs.map((x) => x.key);

  it("zet bewezen maar weinig gebruikte elementen bij Meer doen", () => {
    expect(keys(a.sections.meer)).toContain("meer:format:Woningtour met prijsvraag");
    expect(keys(a.sections.meer)).toContain("meer:hook:Prijs");
    const hook = a.sections.meer.find((i) => i.key === "meer:hook:Prijs")!;
    expect(hook.proof).toBe("bewezen");
    expect(hook.application).toMatch(/Open met de prijs/);
    expect(hook.evidence.length).toBeGreaterThan(0);
    expect(hook.evidence[0].url).toMatch(/^https:/);
  });

  it("zet wat aantoonbaar onder normaal scoort bij Minder doen, met bewijs", () => {
    const team = a.sections.minder.find((i) => i.key === "minder:format:Teamvideo");
    expect(team).toBeTruthy();
    expect(team!.insight).toMatch(/6 video's scoorden gemiddeld/);
    expect(team!.evidence.length).toBe(3);
  });

  it("beoordeelt het middenstuk ook op het uitgekeken deel", () => {
    const tour = [...a.sections.meer, ...a.sections.blijven].find((i) => i.dimension === "opbouw" && i.label === "Rondleiding");
    expect(tour).toBeTruthy();
    expect(tour!.phase).toBe("midden");
    expect(tour!.insight).toMatch(/kijken \d+% verder/);
    expect(a.phases.find((p) => p.phase === "midden")!.doen).toBeTruthy();
  });

  it("corrigeert het uitgekeken deel voor lengte", () => {
    const h = holdScores(m.all);
    expect(h.get("v14")!).toBeGreaterThan(1.5);
    expect(h.get("v0")!).toBeCloseTo(1, 1);
  });

  it("beoordeelt een CTA op het eigen doel en zegt eerlijk wat niet meetbaar is", () => {
    const inter = a.ctaGoals.find((g) => g.goal === "interactie")!;
    expect(inter.measurable).toBe(true);
    expect(inter.rows[0].score!).toBeGreaterThan(2);
    const aanvragen = a.ctaGoals.find((g) => g.goal === "aanvragen")!;
    expect(aanvragen.measurable).toBe(false);
    expect(aanvragen.note).toMatch(/Niet meetbaar/);
    expect(ctaGoalOf({ cta: "Opslaan of delen", ctaText: "Sla deze video op voor later" })).toBe("opslaan");
    expect(ctaGoalOf({ cta: "Opslaan of delen", ctaText: "Deel dit met een collega" })).toBe("delen");
  });

  it("geeft drie prioriteiten en een lijst voor de volgende opnamedag", () => {
    expect(a.priorities.length).toBe(3);
    expect(new Set(a.priorities.map((p) => p.key)).size).toBe(3);
    expect(a.nextShoot.length).toBeGreaterThanOrEqual(3);
    expect(a.nextShoot.some((l) => l.kind === "laten")).toBe(true);
  });

  it("noemt nooit iets bewezen bij te weinig data", () => {
    const few = buildAdvice(analyzeMemory(strong.slice(0, 5), now));
    expect(few.sufficient).toBe(false);
    expect([...few.sections.meer, ...few.sections.blijven, ...few.sections.minder]).toHaveLength(0);
    expect(few.sections.testen.every((i) => i.proof === "hypothese")).toBe(true);
  });

  it("één uitschieter is geen advies", () => {
    const one = analyzeMemory([...normal, vid(99, { caption: "Wat kost deze villa van €900.000?\nLaat het weten in de reacties.", views: 90000, format: "Villatour" })], now);
    const adv = buildAdvice(one);
    expect([...adv.sections.meer, ...adv.sections.blijven].some((i) => i.label === "Villatour" || i.label === "Prijs")).toBe(false);
  });

  it("stelt patronen van andere klanten alleen voor als experiment", () => {
    const adv = buildAdvice(m, { clientId: "a", cross: [{ dimension: "hook", label: "Rondleiding", clientIds: ["b", "c", "a"], medianPerf: 1.6 }] });
    const x = adv.sections.testen.find((i) => i.source === "andere_klanten");
    expect(x).toBeTruthy();
    expect(x!.proof).toBe("hypothese");
    expect(x!.insight).toMatch(/2 andere Shortclips-klanten/);
  });

  it("levert een compacte briefing voor de Script Engine", () => {
    const t = advicePromptText(a, [{ title: "Openen met een vraag", verdict: "niet_effectief" }]);
    expect(t).toMatch(/Meer doen:/);
    expect(t).toMatch(/Minder doen:/);
    expect(t).toMatch(/niet effectief gebleken/);
    expect(t).not.toMatch(/[—–]/);
  });

  it("geeft alleen algemene patronen door aan andere klanten", () => {
    const p = provenPatterns(m, { structures });
    expect(p.some((x) => x.dimension === "hook" && x.label === "Prijs")).toBe(true);
    expect(p.some((x) => x.dimension === "format")).toBe(false);
  });
});

describe("leerlus", () => {
  const target = { dimension: "hook" as const, label: "Prijs" };

  it("ziet dat een advies nog niet is toegepast", () => {
    const r = measureAdvice("meer", target, "2026-11-20", m, {}, now);
    expect(r.executed).toBe(false);
    expect(r.outcome).toBeNull();
  });

  it("markeert als uitgevoerd bij de eerste video en oordeelt pas vanaf drie", () => {
    const since = day(17).toISOString().slice(0, 10); // twee prijsvideo's daarna
    const r = measureAdvice("meer", target, since, m, {}, now);
    expect(r.executed).toBe(true);
    expect(r.outcome).toBeNull();
  });

  it("noemt het advies effectief als de video's daarna consequent sterk scoren", () => {
    const since = day(13).toISOString().slice(0, 10);
    const r = measureAdvice("meer", target, since, m, {}, now);
    expect(r.outcome!.matched).toBe(6);
    expect(r.outcome!.verdict).toBe("effectief");
    expect(r.outcome!.note).toMatch(/6 van 6/);
  });

  it("noemt het advies niet effectief als het daarna onder normaal blijft", () => {
    const since = day(9).toISOString().slice(0, 10);
    const r = measureAdvice("testen", { dimension: "format", label: "Teamvideo" }, since, m, {}, now);
    expect(r.outcome!.verdict).toBe("niet_effectief");
  });

  it("kan een advies zonder meetbaar kenmerk niet zelf beoordelen", () => {
    expect(measureAdvice("testen", null, "2026-01-01", m, {}, now)).toEqual({ executed: false, outcome: null });
  });
});
