import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
vi.mock("@/server/actions/content-memory", () => ({ setAdviceStatusAction: async () => ({ ok: true, message: "" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
import { analyzeMemory, type MemoryInput } from "@/server/content-memory/analyze";
import { buildAdvice } from "@/server/content-memory/advice";
import { ContentAdviceView } from "@/components/content-memory/advice-view";
import { AdviceBrief } from "@/components/content-memory/advice-brief";

const day = (n: number) => new Date(Date.UTC(2026, 5, 1) + n * 86_400_000);
const v = (i: number, o: Partial<MemoryInput> = {}): MemoryInput => ({ id: `v${i}`, platform: "instagram", publishedAt: day(i * 3), caption: `Video nummer ${i} over een mooie woning in Sneek met tuin.\nBel ons gerust voor een bezichtiging.`, durationSeconds: 55, views: 1000, likes: 30, comments: 3, shares: 1, saves: 2, avgWatchSeconds: 12, followerDelta: 0, externalUrl: null, thumbnail: null, spokenHook: null, planTitle: null, planId: null, format: "Wijkportret", ...o });
const ins = [...Array.from({ length: 14 }, (_, i) => v(i)), ...Array.from({ length: 6 }, (_, i) => v(i + 14, { caption: `Wat kost deze woning voor €${300 + i}.000?\nLaat het weten in de reacties.`, views: 3500, comments: 40, format: "Prijsvraag" }))];

describe("weergave", () => {
  it("rendert zonder fouten", () => {
    const m = analyzeMemory(ins, new Date(Date.UTC(2026, 11, 1)));
    const advice = buildAdvice(m);
    const first = [...advice.sections.meer, ...advice.sections.testen, ...advice.sections.blijven][0];
    const rec = { id: "r1", key: first.key, section: first.section, title: first.title, item: first, status: "ingepland" as const, measureFrom: "2026-11-01", outcome: null, statusChangedAt: "2026-11-01", closedAt: null, createdAt: "2026-11-01" };
    const cm = { clientId: "c", clientName: "Testklant", clientSlug: "test", memory: m } as never;
    const html = renderToStaticMarkup(h(ContentAdviceView, { cm, data: { advice, open: { [first.key]: rec }, learned: [], running: [], month: { planned: 1, executed: 0, effective: 0, ineffective: 0 } } }));
    expect(html).toContain("De drie prioriteiten");
    expect(html).toContain("Ingepland");
    expect(html).not.toMatch(/[—–]/);
    expect(renderToStaticMarkup(h(AdviceBrief, { clientName: "Testklant", clientSlug: "test", advice }))).toContain("Doen");
  });
});
