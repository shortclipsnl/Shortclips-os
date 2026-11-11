import { describe, expect, it } from "vitest";
import { MEDEWERKERS, kaal, normaliseer, standaardConfig } from "@/lib/verantwoordelijkheden/data";

describe("Mijn verantwoordelijkheden: standaardverdeling uit de kennisbank", () => {
  const config = standaardConfig();

  it("heeft voor iedere medewerker een rol en minstens één verantwoordelijkheid", () => {
    for (const m of MEDEWERKERS) {
      expect(config.profielen[m.email]?.functie, m.naam).toBeTruthy();
      expect(config.verantwoordelijkheden.filter((v) => v.persoon === m.email).length, m.naam).toBeGreaterThan(0);
    }
  });

  it("heeft geen dubbele verantwoordelijkheden, beslisregels of werkzaamheden per persoon", () => {
    for (const m of MEDEWERKERS) {
      const titels = config.verantwoordelijkheden.filter((v) => v.persoon === m.email).map((v) => v.titel);
      expect(new Set(titels).size, m.naam).toBe(titels.length);
      const regels = config.beslissingen.filter((b) => b.persoon === m.email).map((b) => b.situatie);
      expect(new Set(regels).size, m.naam).toBe(regels.length);
      const werk = config.controles.filter((c) => c.persoon === m.email).map((c) => `${c.frequentie}:${c.titel}`);
      expect(new Set(werk).size, m.naam).toBe(werk.length);
    }
    const ids = config.verantwoordelijkheden.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("legt de facturatie bij Milou met Jiska als vervanger (Financiën 1.1)", () => {
    const f = config.verantwoordelijkheden.find((v) => v.id === "milou-facturatie");
    expect(f?.vervanger).toBe("jiska@shortclips.nl");
    expect(config.verantwoordelijkheden.some((v) => v.id === "jiska-facturatie")).toBe(true);
  });

  it("legt de editorbriefings alleen bij Rutger (Over Shortclips 1.0)", () => {
    const briefing = config.verantwoordelijkheden.filter((v) => /editorbriefing/i.test(v.titel));
    expect(briefing.map((v) => v.persoon)).toEqual(["rutger@shortclips.nl"]);
  });

  it("blijft gelijk na opslaan en opnieuw inlezen", () => {
    const terug = normaliseer(JSON.parse(JSON.stringify(config)));
    expect(terug.verantwoordelijkheden.length).toBe(config.verantwoordelijkheden.length);
    expect(terug.beslissingen.length).toBe(config.beslissingen.length);
    expect(terug.controles.length).toBe(config.controles.length);
    expect(terug.profielen["rutger@shortclips.nl"].kpis).toEqual(config.profielen["rutger@shortclips.nl"].kpis);
  });

  it("bevat geen gedachtestreepjes in teksten voor het team", () => {
    const alles = JSON.stringify(config);
    expect(kaal(alles)).not.toMatch(/[—–]/);
  });
});
