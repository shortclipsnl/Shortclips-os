import { describe, expect, it } from "vitest";
import { structureLines, scriptPlainText, type RawLine } from "@/server/briefing/script-pdf";
import { verifyHighlights } from "@/server/briefing/guide-highlights";
import { scopeCss } from "@/server/briefing/render-html";

let y = 800;
const L = (page: number, size: number, text: string, style: { b?: boolean; i?: boolean } = {}, gap = 14): RawLine => {
  y -= gap;
  return { page, y, size, gapBefore: gap, text, spans: [{ t: text, ...(style.b ? { b: true as const } : {}), ...(style.i ? { i: true as const } : {}) }] };
};

describe("editor-briefing: scripts letterlijk uit de PDF", () => {
  const lines: RawLine[] = [
    L(1, 12, "KKFH 1 december 2026"),
    L(2, 30, "1. Stoken vs"),
    L(2, 30, "Kunststofkozijnen"),
    L(2, 10, "SHORTCLIP UITLEG", { b: true }),
    L(2, 10, "Een klant belt KKFH omdat hij schrikt van zijn energierekening."),
    L(2, 10, "HOOK", { b: true }),
    L(2, 10, "Klant: December was al duur genoeg!"),
    L(2, 10, "MIDDENSTUK", { b: true }),
    L(2, 10, "BOOMVERZORGER:", { b: true }),
    L(2, 10, "Maarr geloof mij, dit gaat je geld schelen!"),
    L(2, 10, "Beeld vanuit de Meta bril.", { i: true }),
    L(2, 10, "CALL TO ACTION", { b: true }),
    L(2, 10, "Laat het weten!"),
    L(3, 30, "Stoken vs Kunststofkozijnen"), // vervolgpagina, zelfde titel
    L(3, 10, "Nog een regel op de vervolgpagina."),
    L(4, 30, "Elfstedentocht"),
    L(4, 10, "SKETCH", { b: true }),
    L(4, 10, "Collega 1: It giet oan!"),
  ];
  const r = structureLines(lines, 4, []);

  it("herkent titels, ook over twee regels en zonder nummer", () => {
    expect(r.scripts.map((s) => s.title)).toEqual(["Stoken vs Kunststofkozijnen", "Elfstedentocht"]);
    expect(r.scripts[0]!.pages).toEqual([2, 3]);
  });

  it("behoudt de originele indeling en labels", () => {
    expect(r.scripts[0]!.sections.map((s) => [s.kind, s.label])).toEqual([
      ["uitleg", "SHORTCLIP UITLEG"],
      ["hook", "HOOK"],
      ["scene", "MIDDENSTUK"],
      ["cta", "CALL TO ACTION"],
    ]);
    expect(r.scripts[1]!.sections[0]!.label).toBe("SKETCH");
  });

  it("verandert geen woord (ook geen typefouten) en ziet een spreker niet als kop", () => {
    const text = scriptPlainText(r.scripts[0]!);
    expect(text).toContain("Maarr geloof mij, dit gaat je geld schelen!");
    expect(text).toContain("BOOMVERZORGER:");
    expect(text).toContain("Nog een regel op de vervolgpagina.");
  });
});

describe("editor-briefing: highlights alleen letterlijk uit de guide", () => {
  const guide = "Ondertiteling\nEén balk, altijd in de kleur van de werkmaatschappij.\nNIET\nMuziek boven de stem\nShots van 2 – 4 sec";
  it("laat letterlijke regels door en gooit verzonnen of herschreven regels weg", () => {
    const out = verifyHighlights(
      [
        { categorie: "Ondertiteling", tekst: "Eén balk, altijd in de kleur van de werkmaatschappij.", niet: false, kritiek: true },
        { categorie: "Audio", tekst: "Muziek boven de stem", niet: true, kritiek: false },
        { categorie: "Tempo", tekst: "Shots van 2 - 4 sec", niet: false, kritiek: false }, // ander streepje: mag
        { categorie: "Tempo", tekst: "Houd het tempo hoog", niet: false, kritiek: false }, // verzonnen
        { categorie: "Ondertiteling", tekst: "Eén balk in de kleur van het merk.", niet: false, kritiek: false }, // herschreven
      ],
      guide,
    );
    expect(out.map((h) => h.tekst)).toEqual([
      "Eén balk, altijd in de kleur van de werkmaatschappij.",
      "Muziek boven de stem",
      "Shots van 2 - 4 sec",
    ]);
    expect(out[1]!.niet).toBe(true);
  });
  it("maximaal 7", () => {
    const many = Array.from({ length: 10 }, () => ({ categorie: "x", tekst: "Muziek boven de stem", niet: true, kritiek: false }));
    expect(verifyHighlights(many, guide).length).toBe(1); // dubbelen vallen weg
  });
});

describe("editor-briefing: opmaak raakt de rest van het portaal niet", () => {
  it("scoped alle regels, ook binnen @media", () => {
    const css = scopeCss(".a { x: 1 }\n@media (max-width: 1px) { .b { y: 2 } }", ".root");
    expect(css).toContain(".root .a");
    expect(css).toContain(".root .b");
  });
});
