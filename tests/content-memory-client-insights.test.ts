import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
vi.mock("@/server/actions/content-memory", () => ({ setAdviceStatusAction: async () => ({ ok: true, message: "" }), setInsightReviewAction: async () => ({ ok: true, message: "" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
import { analyzeMemory, type MemoryInput } from "@/server/content-memory/analyze";
import { buildAdvice, type AdviceItem } from "@/server/content-memory/advice";
import { buildClientInsights, defaultText, defaultTitle, insightTier, pendingReviews, proofLine, type InsightReview } from "@/server/content-memory/client-insights";
import { WhatWorks } from "@/components/content-memory/what-works";
import { ClientMemoryView } from "@/components/content-memory/client-view";
import { ContentAdviceView } from "@/components/content-memory/advice-view";

const day = (n: number) => new Date(Date.UTC(2026, 5, 1) + n * 86_400_000);
const v = (i: number, o: Partial<MemoryInput> = {}): MemoryInput => ({ id: `v${i}`, platform: "instagram", publishedAt: day(i * 3), caption: `Video nummer ${i} over een mooie woning in Sneek met tuin.\nBel ons gerust voor een bezichtiging.`, durationSeconds: 55, views: 1000, likes: 30, comments: 3, shares: 1, saves: 2, avgWatchSeconds: 12, followerDelta: 0, externalUrl: null, thumbnail: null, spokenHook: null, planTitle: null, planId: null, format: "Wijkportret", ...o });
const ins = [...Array.from({ length: 14 }, (_, i) => v(i)), ...Array.from({ length: 6 }, (_, i) => v(i + 14, { caption: `Wat kost deze woning voor €${300 + i}.000?\nLaat het weten in de reacties.`, views: 3500, comments: 40, format: "Prijsvraag" }))];

const m = analyzeMemory(ins, new Date(Date.UTC(2026, 11, 1)));
const advice = buildAdvice(m);
const all = [...advice.sections.meer, ...advice.sections.blijven, ...advice.sections.minder, ...advice.sections.testen];
const approve = (keys: string[], extra: Partial<InsightReview> = {}): InsightReview[] => keys.map((key) => ({ key, decision: "tonen", clientTitle: null, clientText: null, reviewedAt: "2026-11-15T00:00:00.000Z", ...extra }));
const base = { sections: advice.sections, open: {}, running: [], learned: [] };
const item = (o: Partial<AdviceItem>): AdviceItem => ({ ...all[0], ...o });

describe("niveau voor de klant", () => {
  it("bewezen vraagt minstens acht video's", () => {
    expect(insightTier({ proof: "bewezen", n: 8, source: "resultaten" })).toBe("bewezen");
    expect(insightTier({ proof: "bewezen", n: 4, source: "resultaten" })).toBe("voorlopig");
    expect(insightTier({ proof: "hypothese", n: 5, source: "resultaten" })).toBe("voorlopig");
    expect(insightTier({ proof: "hypothese", n: 2, source: "resultaten" })).toBe("hypothese");
  });
  it("een nieuw voorstel is altijd een hypothese", () => {
    expect(insightTier({ proof: "bewezen", n: 20, source: "voorstel" })).toBe("hypothese");
    expect(insightTier({ proof: "hypothese", n: 0, source: "andere_klanten" })).toBe("hypothese");
  });
});

describe("standaardteksten", () => {
  it("gebruiken alleen de echte cijfers en geen vaktaal", () => {
    expect(defaultTitle({ title: "Prijs direct in de hook", dimension: "hook", label: "Prijs" })).toBe("Prijs direct in de opening");
    expect(defaultTitle({ title: 'Format "Woningtour"', dimension: "format", label: "Woningtour" })).toBe('Video\'s in het format "Woningtour"');
    expect(defaultText({ section: "meer", perf: 1.34, n: 9, source: "resultaten" })).toBe("Video's hiermee halen 1,3x je normale niveau.");
    expect(defaultText({ section: "minder", perf: 0.6, n: 5, source: "resultaten" })).toContain("0,6x");
    expect(proofLine({ n: 14, hits: 10 })).toBe("14 video's, waarvan 10 boven je normale niveau");
    expect(proofLine({ n: 0, hits: 0 })).toContain("nieuw voorstel");
  });
});

describe("klantweergave", () => {
  it("toont niets zonder goedkeuring", () => {
    expect(all.length).toBeGreaterThan(0);
    const out = buildClientInsights({ ...base, reviews: [] });
    expect(out.shown).toBe(0);
    expect(pendingReviews(advice.sections, [])).toBe(all.length);
    expect(renderToStaticMarkup(h(WhatWorks, { insights: out }))).toBe("");
  });

  it("toont alleen goedgekeurde inzichten, in de juiste groep", () => {
    const keys = all.map((i) => i.key);
    const out = buildClientInsights({ ...base, reviews: [...approve(keys.slice(0, 1)), { key: keys[1] ?? "x", decision: "verbergen", clientTitle: null, clientText: null, reviewedAt: null }] });
    expect(out.shown).toBe(1);
    const shown = [...out.goed, ...out.minder, ...out.testen][0];
    expect(shown.key).toBe(keys[0]);
    expect(shown.group).toBe(all[0].section === "minder" ? "minder" : all[0].section === "testen" ? "testen" : "goed");
    expect(shown.videos).toEqual(all[0].evidence);
    expect(pendingReviews(advice.sections, approve(keys))).toBe(0);
  });

  it("gebruikt de eigen tekst van het team als die is ingevuld", () => {
    const out = buildClientInsights({ ...base, reviews: approve([all[0].key], { clientTitle: "Eigen titel", clientText: "Eigen toelichting." }) });
    const shown = [...out.goed, ...out.minder, ...out.testen][0];
    expect(shown.title).toBe("Eigen titel");
    expect(shown.text).toBe("Eigen toelichting.");
    expect(shown.proofLine).toBe(proofLine(all[0]));
  });

  it("laat zien wat is verbeterd, met de video's waarin het is toegepast", () => {
    const i = item({ key: "meer:hook:Prijs", section: "meer", dimension: "hook", label: "Prijs", title: "Prijs direct in de hook" });
    const rec = { id: "r1", key: i.key, section: i.section, title: i.title, item: i, status: "effectief" as const, measureFrom: "2026-10-01T00:00:00.000Z", outcome: { videosAfter: 5, matched: 3, median: 1.4, hits: 3, before: null, verdict: "effectief" as const, note: "intern", videoIds: ["v1", "v2", "onbekend"], measuredAt: "2026-11-10T00:00:00.000Z" }, statusChangedAt: "2026-11-10T00:00:00.000Z", closedAt: "2026-11-10T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" };
    const ref = (id: string) => (id === "onbekend" ? null : { id, title: `Video ${id}`, platform: "instagram", url: null, perf: 1.4, views: 1000, thumbnail: null, publishedOn: "2026-10-10" });
    const out = buildClientInsights({ sections: { meer: [], blijven: [], minder: [], testen: [] }, open: {}, running: [], learned: [rec], reviews: approve([i.key]), videoRef: ref });
    expect(out.verbeterd).toHaveLength(1);
    expect(out.verbeterd[0].statusLabel).toBe("Werkt");
    expect(out.verbeterd[0].result).toContain("1,4x je normale niveau");
    expect(out.verbeterd[0].result).not.toContain("intern");
    expect(out.verbeterd[0].videos.map((x) => x.id)).toEqual(["v1", "v2"]);
    // Zonder goedkeuring blijft ook de verbetering onzichtbaar.
    expect(buildClientInsights({ sections: { meer: [], blijven: [], minder: [], testen: [] }, open: {}, running: [], learned: [rec], reviews: [] }).verbeterd).toHaveLength(0);
  });

  it("toont een test met de stap waarin hij zit", () => {
    const i = item({ key: "testen:lengte:20 tot 35 sec", section: "testen", dimension: "lengte", label: "20 tot 35 sec", title: "Video's van 20 tot 35 sec", proof: "hypothese", n: 4, hits: 4 });
    const rec = { id: "r2", key: i.key, section: i.section, title: i.title, item: i, status: "ingepland" as const, measureFrom: "2026-11-01T00:00:00.000Z", outcome: null, statusChangedAt: "2026-11-01T00:00:00.000Z", closedAt: null, createdAt: "2026-11-01T00:00:00.000Z" };
    const out = buildClientInsights({ sections: { meer: [], blijven: [], minder: [], testen: [i] }, open: { [i.key]: rec }, running: [], learned: [], reviews: approve([i.key]) });
    expect(out.testen[0].step).toBe(2);
    expect(out.testen[0].tier).toBe("voorlopig");
    expect(out.verbeterd).toHaveLength(0);
    const html = renderToStaticMarkup(h(WhatWorks, { insights: out }));
    expect(html).toContain("Lopende en geplande tests");
    expect(html).toContain("2. Ingepland");
  });

  it("rendert in het portaal en bij het team zonder fouten", () => {
    const cm = { clientId: "c", clientName: "Testklant", clientSlug: "test", memory: m, ai: { formats: [], labels: {}, structures: {}, ideas: [], updatedAt: null, model: null }, playbook: { items: [] } } as never;
    const reviews = approve(all.map((i) => i.key));
    const insights = buildClientInsights({ ...base, reviews });
    const client = renderToStaticMarkup(h(ClientMemoryView, { cm, insights }));
    expect(client).toContain("Wat werkt bij jouw bedrijf?");
    expect(client).toContain("Bewijs:");
    expect(client).not.toMatch(/[—–]/);
    expect(renderToStaticMarkup(h(ClientMemoryView, { cm }))).toContain("Wat we over jouw content hebben geleerd");
    const team = renderToStaticMarkup(h(ContentAdviceView, { cm, data: { advice, open: {}, learned: [], running: [], month: { planned: 0, executed: 0, effective: 0, ineffective: 0 } }, reviews: reviews.slice(0, 1) }));
    expect(team).toContain("Goedkeuren voor klant");
    expect(team).toContain("Zichtbaar voor klant");
    expect(team).toContain("nog niet beoordeeld");
  });
});
