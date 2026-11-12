import { describe, expect, it } from "vitest";
import { MIN_TOTAAL, normalizeKeuring, rankByQuality, readKeuring } from "@/server/content-research/quality";
import { cleanScriptText, normalizeStyle, pickStyleFiles, styleFingerprint, styleToText } from "@/server/content-research/style-core";

const sterk = {
  stijlFit: 9, stijlFitToelichting: "klinkt als sessie 9",
  bewezenPatroon: 9, bewezenPatroonBasis: "data", bewezenPatroonToelichting: "prijsvergelijking 3x mediaan",
  relevantie: 9, originaliteit: 8, uitvoerbaarheid: 9,
  stijlProblemen: [], oordeel: "Sterk.",
};

describe("kwaliteitskeuring", () => {
  it("laat een sterk, stijlvast idee met videodata door", () => {
    const k = normalizeKeuring(sterk, { hasVideoData: true, hasProvenHooks: false });
    expect(k.totaal).toBeGreaterThanOrEqual(MIN_TOTAAL);
    expect(k.geslaagd).toBe(true);
    expect(k.afwijsReden).toBeNull();
  });

  it("wijst af bij stijl-fit onder 8, ook als het totaal hoog is", () => {
    const k = normalizeKeuring({ ...sterk, stijlFit: 7, relevantie: 10, originaliteit: 10, uitvoerbaarheid: 10 }, { hasVideoData: true, hasProvenHooks: true });
    expect(k.totaal).toBeGreaterThanOrEqual(80);
    expect(k.geslaagd).toBe(false);
    expect(k.afwijsReden).toContain("stijl-fit");
  });

  it("stijlproblemen drukken stijl-fit naar maximaal 6", () => {
    const k = normalizeKeuring({ ...sterk, stijlFit: 10, stijlProblemen: ["'Hallo, deze is net binnen' past niet"] }, { hasVideoData: true, hasProvenHooks: true });
    expect(k.onderdelen.stijlFit.score).toBe(6);
    expect(k.geslaagd).toBe(false);
  });

  it("'data' zonder videodata wordt inschatting en bewezen patroon max. 6", () => {
    const k = normalizeKeuring(sterk, { hasVideoData: false, hasProvenHooks: false });
    expect(k.onderdelen.bewezenPatroon.basis).toBe("inschatting");
    expect(k.onderdelen.bewezenPatroon.score).toBe(6);
  });

  it("rangschikt geslaagd vóór gezakt, daarna op totaal", () => {
    const a = { id: "a", keuring: normalizeKeuring({ ...sterk, stijlFit: 6 }, { hasVideoData: true, hasProvenHooks: true }) };
    const b = { id: "b", keuring: normalizeKeuring(sterk, { hasVideoData: true, hasProvenHooks: true }) };
    expect(rankByQuality([a, b]).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("leest een opgeslagen keuring terug en negeert oude ideeën", () => {
    const k = normalizeKeuring(sterk, { hasVideoData: true, hasProvenHooks: true });
    expect(readKeuring(JSON.parse(JSON.stringify(k)))?.totaal).toBe(k.totaal);
    expect(readKeuring({})).toBeNull();
    expect(readKeuring(null)).toBeNull();
  });
});

describe("stijlprofiel", () => {
  const rows = [
    { externalId: "1", name: "Organisch - Scripts - KOOPS SESSIE 9.pdf", mimeType: "application/pdf", sizeBytes: 3_600_000, modifiedAt: "2026-11-06" },
    { externalId: "2", name: "Filmversie - Scripts - Koops.pdf", mimeType: "application/pdf", sizeBytes: 3_500_000, modifiedAt: "2026-11-07" },
    { externalId: "3", name: "Draaiboek_opnamedag.pdf", mimeType: "application/pdf", sizeBytes: 280_000, modifiedAt: "2026-11-05" },
    { externalId: "4", name: "._Short video scripts.pdf", mimeType: "application/pdf", sizeBytes: 4_096, modifiedAt: "2026-11-08" },
    { externalId: "5", name: "Advertentie Scripts - Koops.pdf", mimeType: "application/pdf", sizeBytes: 3_400_000, modifiedAt: "2026-10-07" },
    { externalId: "6", name: "Organisch - Scripts - Koops Sessie 8 .pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sizeBytes: 4_000_000, modifiedAt: "2026-11-06" },
    { externalId: "7", name: "4 SCRIPTS - 24 NOVEMBER", mimeType: "application/vnd.google-apps.document", sizeBytes: 6_000, modifiedAt: "2026-10-30" },
    { externalId: "8", name: "Organisch - Scripts - KOOPS SESSIE 9 (1).pdf", mimeType: "application/pdf", sizeBytes: 3_600_001, modifiedAt: "2026-11-01" },
    { externalId: "9", name: "Short video script.pdf", mimeType: "application/pdf", sizeBytes: 3_600_000, modifiedAt: "2026-09-01" },
  ];

  it("kiest alleen echte organische scripts, zonder dubbele exports", () => {
    const picked = pickStyleFiles(rows).map((r) => r.externalId);
    expect(picked).toEqual(["1", "7"]);
  });

  it("vingerafdruk verandert bij een nieuw bestand of nieuwe teamcorrectie", () => {
    const a = styleFingerprint(rows.slice(0, 1));
    expect(styleFingerprint(rows.slice(0, 1))).toBe(a);
    expect(styleFingerprint(rows.slice(0, 2))).not.toBe(a);
    expect(styleFingerprint(rows.slice(0, 1), "nooit hallo")).not.toBe(a);
  });

  it("normaliseert en zet teamcorrecties bovenaan de prompttekst", () => {
    const p = normalizeStyle({ samenvatting: "Korte zinnen.", voorbeeldHooks: ["€20.000, €40.000 of €70.000?", "€20.000, €40.000 of €70.000?"], pastNiet: ["begroetingen"] });
    expect(p.voorbeeldHooks).toHaveLength(1);
    const t = styleToText(p, "Nooit 'hallo'.");
    expect(t.indexOf("CORRECTIES VAN HET TEAM")).toBe(0);
    expect(t).toContain("PAST NIET");
  });

  it("schoont scripttekst op", () => {
    expect(cleanScriptText("a  b\r\n\n\n\nc", 100)).toBe("a b\n\nc");
  });
});

describe("hookproblemen", () => {
  it("herkent een stijlprobleem dat over een hook gaat", async () => {
    const { hookIndexInProblem } = await import("@/server/content-research/judge");
    const hooks = ["Deze cursus van € 1.000 kost je zakelijk dus niet gewoon € 1.000.", "Volg jij dit jaar een cursus voor je werk? Vergeet dit niet."];
    expect(hookIndexInProblem("'Volg jij dit jaar een cursus voor je werk? Vergeet dit niet.' – zegt niet wat je moet onthouden.", hooks)).toBe(1);
    expect(hookIndexInProblem("'Bewaar dus je factuur' is te vaag", hooks)).toBe(-1);
  });
});

describe("correctieronde", () => {
  it("vervangt alleen aangewezen regels en vult afgekeurde hooks aan", async () => {
    const { applyCorrections } = await import("@/server/content-research/judge");
    const k = normalizeKeuring(sterk, { hasVideoData: true, hasProvenHooks: true });
    const c = {
      titel: "t", concept: "c", hooks: ["Hook één die blijft staan."], waaromWerkt: "", doel: "", inspiratieUrl: null, inspiratieLabel: null,
      categorie: "overig", uitvoerbaarheid: "gemiddeld", score: 0, scoreReason: "", middenstuk: ["Regel een.", "Een vage regel zonder bedrag.", "Regel drie."],
      ctaCommercieel: "Bel ons.", ctaInteractie: "Laat het weten in de poll!", invalshoek: "", onderbouwing: [], opportunity: {}, herhaalReden: null,
      keuring: k, verwijderdeHooks: ["Hallo!"],
    };
    const out = applyCorrections(c, { vervangingen: [{ oud: "Een vage regel zonder bedrag.", nieuw: "Dat is €250 PER maand." }], nieuweHooks: ["Je koopt een chalet van €60.000. Maar wat kost hij daarna?"] });
    expect(out.middenstuk).toEqual(["Regel een.", "Dat is €250 PER maand.", "Regel drie."]);
    expect(out.hooks).toHaveLength(2);
    expect(out.ctaInteractie).toBe("Laat het weten in de poll!");
    expect("keuring" in out).toBe(false);
  });
});

describe("bijna-dubbele ideeën", () => {
  it("toont geen twee varianten van hetzelfde idee", async () => {
    const { pickShown } = await import("@/server/content-research/quality");
    const k = normalizeKeuring(sterk, { hasVideoData: true, hasProvenHooks: true });
    const a = { titel: "Hoeveel adressen doe jij eigenlijk op één dag?", hooks: ["Hé, hoeveel adressen doe jij eigenlijk op ÉÉN dag?"], keuring: k };
    const b = { titel: "Hoeveel adressen doe jij op één dag?", hooks: ["Hoeveel adressen doet een chauffeur eigenlijk op ÉÉN dag?"], keuring: k };
    const c = { titel: "Hoe lang is zo'n vrachtwagen eigenlijk?", hooks: ["Hoe LANG is zo'n vrachtwagen eigenlijk?"], keuring: k };
    expect(pickShown([a, b, c], 5).map((x) => x.titel)).toEqual([a.titel, c.titel]);
  });
});
