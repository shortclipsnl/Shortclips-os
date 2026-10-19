import { describe, expect, it } from "vitest";
import { buildScriptDocx, scriptSections, type ScriptForDoc } from "@/server/scripts/document-build";

const base: ScriptForDoc = {
  id: "1",
  title: "Zonnepanelen uitgelegd",
  pillar: "Zonnepanelen",
  format: "Talking head",
  hook: null,
  body: "[Hook]\nWist je dit over zonnepanelen?\n\n[Kern]\nIn drie punten de voordelen.\nTweede regel.\n\n[Afsluiting]\nSamenvatting in één zin.",
  cta: null,
  locationName: "Hoofdvestiging",
  presenter: "Contactpersoon",
  requirements: "Bedrijfskleding",
};

describe("scriptSections", () => {
  it("haalt hook/kern/cta uit een gelabelde body", () => {
    const s = scriptSections(base);
    expect(s.hook).toBe("Wist je dit over zonnepanelen?");
    expect(s.middenstuk).toContain("In drie punten de voordelen.");
    expect(s.middenstuk).toContain("Tweede regel.");
    expect(s.cta).toBe("Samenvatting in één zin.");
    expect(s.typeVideo).toContain("Talking head");
    expect(s.typeVideo).toContain("Hoofdvestiging");
    expect(s.uitleg).toBe("Zonnepanelen");
  });

  it("gebruikt de aparte velden als de body geen labels heeft", () => {
    const s = scriptSections({ ...base, hook: "Losse hook", cta: "Losse cta", body: "Gewone middenstuktekst zonder labels." });
    expect(s.hook).toBe("Losse hook");
    expect(s.cta).toBe("Losse cta");
    expect(s.middenstuk).toBe("Gewone middenstuktekst zonder labels.");
  });
});

describe("buildScriptDocx", () => {
  it("levert een geldig .docx (zip) voor één script", async () => {
    const buf = await buildScriptDocx([base], { title: "Script — test", subtitle: "Klant · sessie" });
    expect(buf.length).toBeGreaterThan(1000);
    // .docx is een zip-bestand → begint met "PK".
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("voegt meerdere scripts samen in één document", async () => {
    const buf = await buildScriptDocx([base, { ...base, id: "2", title: "Tweede script" }], { title: "Scripts — sessie" });
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buf.length).toBeGreaterThan(1500);
  });
});
