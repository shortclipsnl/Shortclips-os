import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ClientYearView } from "@/components/content-memory/client-year-view";
import { analyzeMemory, type MemoryInput } from "@/server/content-memory/analyze";
import { buildYearView, firstSentence, yearPeriod } from "@/server/content-memory/year-view";
import type { PortalVideo } from "@/server/portal-videos";

const NOW = new Date("2026-11-16T10:00:00Z");

function input(id: string, platform: string, day: string, views: number, caption: string, extra: Partial<MemoryInput> = {}): MemoryInput {
  return {
    id, platform, publishedAt: new Date(`${day}T10:00:00Z`), caption, durationSeconds: 30, views,
    likes: Math.round(views * 0.05), comments: 1, shares: 1, saves: 1, avgWatchSeconds: 10, followerDelta: 0,
    externalUrl: `https://www.tiktok.com/@x/video/${id.replace(/\D/g, "") || 1}`, thumbnail: null, spokenHook: null,
    planTitle: null, planId: null, format: null, ...extra,
  };
}

function portal(key: string, day: string, parts: Array<{ id: string; platform: string; views: number }>): PortalVideo {
  const platforms = parts.map((p) => ({ platform: p.platform, publicationId: p.id, url: null, embedSrc: null, views: p.views, reach: 0, likes: Math.round(p.views * 0.05), comments: 1, shares: 1, saves: 1, avgWatchSeconds: 10 }));
  const sum = (k: "views" | "likes" | "comments" | "shares" | "saves") => platforms.reduce((a, p) => a + p[k], 0);
  return {
    key, title: `Video ${key}`, publishedAt: day, platforms,
    views: sum("views"), reach: 0, likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), saves: sum("saves"),
    interactions: sum("likes") + sum("comments") + sum("shares") + sum("saves"),
    avgWatchSeconds: 10, thumbUrl: null, playSrc: null, embedSrc: null, externalUrl: null,
  };
}

describe("yearPeriod", () => {
  it("start op 1 januari van het huidige jaar", () => {
    expect(yearPeriod(NOW, null)).toMatchObject({ from: "2026-01-01", to: "2026-11-16", startedLate: false, year: 2026 });
    expect(yearPeriod(NOW, "2024-05-01").from).toBe("2026-01-01");
  });
  it("gebruikt de latere startdatum van de klant", () => {
    expect(yearPeriod(NOW, "2026-06-15")).toMatchObject({ from: "2026-06-15", startedLate: true });
  });
  it("begint in een nieuw jaar opnieuw op 1 januari", () => {
    expect(yearPeriod(new Date("2027-01-03T10:00:00Z"), "2026-06-15")).toMatchObject({ from: "2027-01-01", year: 2027 });
  });
});

describe("firstSentence", () => {
  it("geeft de eerste uitgesproken zin letterlijk terug", () => {
    expect(firstSentence("Wist je dat dit huis maar 200.000 euro kost? Kom kijken.")).toBe("Wist je dat dit huis maar 200.000 euro kost?");
    expect(firstSentence("  ")).toBeNull();
  });
});

describe("buildYearView", () => {
  const days = ["2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];
  const inputs: MemoryInput[] = [];
  const videos: PortalVideo[] = [];
  days.forEach((d, i) => {
    const strong = i % 2 === 0;
    const cap = `Caption nummer ${i} met genoeg tekst om te herkennen ${strong ? "?" : "."}`;
    const fmt = strong ? "Rondleiding" : "Uitleg";
    const views = strong ? 5000 + i * 100 : 1000;
    // Elke video staat op TikTok én Instagram: telt als één video.
    inputs.push(input(`t${i}`, "tiktok", d, views, cap, { format: fmt, spokenHook: strong ? `Gesproken opening ${i}` : null }));
    inputs.push(input(`i${i}`, "instagram", d, Math.round(views / 2), cap, { format: fmt, durationSeconds: 30 }));
    videos.push(portal(`v${i}`, d, [{ id: `t${i}`, platform: "tiktok", views }, { id: `i${i}`, platform: "instagram", views: Math.round(views / 2) }]));
  });
  // Video van vorig jaar: valt buiten de periode.
  videos.push(portal("oud", "2025-12-20", [{ id: "x", platform: "tiktok", views: 99999 }]));

  const period = yearPeriod(NOW, null);
  const memory = analyzeMemory(inputs.filter((p) => p.publishedAt! >= new Date("2026-01-01")), NOW);
  const view = buildYearView({ period, videos, memory, ai: { formats: [], structures: {} }, transcripts: new Map([["t2", "Dit zei ik letterlijk in de video."]]) });

  it("telt crossposts als één video en alleen de periode", () => {
    expect(view.videoCount).toBe(8);
    expect(view.top.some((v) => v.key === "oud")).toBe(false);
    expect(view.totalViews).toBe(videos.filter((v) => v.key !== "oud").reduce((a, v) => a + v.views, 0));
    expect(view.platforms.map((p) => p.platform).sort()).toEqual(["instagram", "tiktok"]);
  });

  it("vergelijkt met de gemiddelde video en markeert bovengemiddeld", () => {
    const best = view.top[0];
    expect(best.vsAverage).toBeGreaterThan(1.2);
    expect(best.above).toBe(true);
    expect(view.top.find((v) => v.views === 1500)?.above).toBe(false);
  });

  it("vindt het terugkerende format met het aantal video's", () => {
    const g = view.patterns.find((p) => p.dimension === "format");
    expect(g?.label).toBe("Rondleiding");
    expect(g?.n).toBe(4);
    expect(g?.kind).toBe("patroon");
    expect(view.formats[0].label).toBe("Rondleiding");
  });

  it("toont alleen letterlijke openingszinnen, transcript gaat voor script", () => {
    const op = view.openings.map((v) => v.opening);
    expect(op.length).toBeGreaterThan(0);
    expect(op.every((o) => o && (o.source === "transcript" || o.source === "script"))).toBe(true);
    expect(view.openings.find((v) => v.key === "v2")?.opening).toEqual({ text: "Dit zei ik letterlijk in de video.", source: "transcript" });
    expect(view.openings.some((v) => v.key === "v1")).toBe(false);
  });

  it("trekt geen conclusies bij te weinig video's", () => {
    const small = buildYearView({ period, videos: videos.slice(0, 3), memory: analyzeMemory(inputs.slice(0, 6), NOW), ai: { formats: [], structures: {} }, transcripts: new Map() });
    expect(small.sufficient).toBe(false);
    expect(small.patterns).toEqual([]);
    expect(small.hero).toEqual([]);
  });

  it("rendert de klantpagina met periode, slider en openingszinnen", () => {
    const html = renderToStaticMarkup(h(ClientYearView, { view }));
    expect(html).toContain("1 januari tot en met 16 november 2026");
    expect(html).toContain("Zo ziet jouw best presterende video eruit");
    expect(html).toContain("Je best presterende video&#x27;s van dit jaar");
    expect(html).toContain("Dit zei ik letterlijk in de video.");
    expect(html).toContain("Bovengemiddeld");
  });
});
