import { describe, expect, it } from "vitest";
import { buildDraaiboekContent, mergeHints } from "@/server/draaiboek/build";
import { sessionProgress } from "@/server/draaiboek/types";
import type { ParsedScriptPdf } from "@/server/briefing/script-pdf";

const parsed: ParsedScriptPdf = {
  structured: true,
  pageCount: 2,
  imagePages: [],
  warnings: [],
  scripts: [
    {
      index: 1,
      title: "Energienota versus kozijnen",
      pages: [1],
      links: [],
      sections: [
        { label: "SHORTCLIP UITLEG", kind: "uitleg", lines: [{ spans: [{ t: "Uitleg die de videograaf niet nodig heeft.", i: true }] }] },
        { label: "HOOK", kind: "hook", lines: [{ spans: [{ t: "Jouw energienota is hoger dan nodig." }] }, { spans: [{ t: "Beeld: medium shot bij oud kozijn" }] }] },
        {
          label: "MIDDENSTUK",
          kind: "scene",
          lines: [
            { spans: [{ t: "Een oud kozijn verliest warmte." }] },
            { spans: [{ t: "Presentatrice wijst naar de naad", i: true }] },
            { spans: [{ t: "Tekst in beeld 0-3s: 30% warmteverlies" }] },
            { spans: [{ t: "B-roll: close-up van de afdichting" }] },
            { spans: [{ t: "Een nieuw kozijn sluit op elke hoek." }] },
          ],
        },
        { label: "CALL TO ACTION", kind: "cta", lines: [{ spans: [{ t: "Plan een gratis inmeting." }] }] },
      ],
    },
  ],
};

describe("draaiboek uit script", () => {
  const c = buildDraaiboekContent(parsed);
  const v = c.videos[0]!;

  it("neemt de scripttekst letterlijk over, onder elkaar", () => {
    expect(v.hook.tekst).toBe("Jouw energienota is hoger dan nodig.");
    expect(v.middenstuk.tekst).toBe("Een oud kozijn verliest warmte.\nEen nieuw kozijn sluit op elke hoek.");
    expect(v.cta.tekst).toBe("Plan een gratis inmeting.");
  });

  it("maakt beeld- en regieregels korte aanwijzingen, B-roll apart, en laat tekst in beeld weg", () => {
    expect(v.hook.aanwijzingen).toEqual(["medium shot bij oud kozijn"]);
    expect(v.middenstuk.aanwijzingen).toEqual(["Presentatrice wijst naar de naad"]);
    expect(v.broll).toEqual(["close-up van de afdichting"]);
    expect(JSON.stringify(c)).not.toContain("Tekst in beeld");
    expect(JSON.stringify(c)).not.toContain("Uitleg die");
  });

  it("voegt AI-aanwijzingen alleen kort en zonder uitgesproken tekst toe", () => {
    const merged = mergeHints(structuredClone(c), {
      videos: [{ nr: 1, hook: ["Jouw energienota is hoger dan nodig", "Energienota in beeld houden", "veel te lange aanwijzing die echt nergens op slaat en door blijft gaan"], cta: ["Recht in de camera"], broll: ["Glas in detail"] }],
    });
    const m = merged.videos[0]!;
    expect(m.hook.aanwijzingen).toEqual(["medium shot bij oud kozijn", "Energienota in beeld houden"]);
    expect(m.cta.aanwijzingen).toEqual(["Recht in de camera"]);
    expect(m.broll).toEqual(["close-up van de afdichting", "Glas in detail"]);
  });

  it("toont één voortgang over de hele sessie", () => {
    expect(sessionProgress(c, {})).toMatchObject({ done: 0, total: 4, pct: 0 });
    expect(sessionProgress(c, { v1: { hook: true, middenstuk: true } })).toMatchObject({ done: 2, total: 4, pct: 50 });
  });
});
