import { describe, expect, it } from "vitest";
import { VERANTWOORDELIJKEN, standaardConfig } from "@/lib/verantwoordelijkheden/data";
import { VIER_NIVEAUS, moetVastleggen, rolVoor, zonderVastleggen } from "@/lib/verantwoordelijkheden/rol";

describe("Mijn verantwoordelijkheden: rolinhoud en vier niveaus", () => {
  it("heeft voor Milou, Jiska en Rutger een rol met maximaal vijf KPI's", () => {
    for (const m of VERANTWOORDELIJKEN) {
      const rol = rolVoor(m.email);
      expect(rol, m.naam).not.toBeNull();
      expect(rol!.kpis.length, m.naam).toBeLessThanOrEqual(5);
      expect(new Set(rol!.kpis.map((k) => k.id)).size, m.naam).toBe(rol!.kpis.length);
      expect(rol!.missie.length, m.naam).toBeGreaterThan(20);
      expect(rol!.scenarios.length, m.naam).toBeGreaterThan(0);
    }
    expect(rolVoor("milou@shortclips.nl")!.key).toBe("cc");
    expect(rolVoor("JISKA@shortclips.nl")!.key).toBe("cc");
    expect(rolVoor("rutger@shortclips.nl")!.key).toBe("videograaf");
  });

  it("geeft Jarno en onbekenden geen rol", () => {
    expect(rolVoor("jarno@shortclips.nl")).toBeNull();
    expect(rolVoor("iemand@voorbeeld.nl")).toBeNull();
    expect(rolVoor(null)).toBeNull();
  });

  it("splitst bevoegdheden in zelf oplossen en zelf oplossen en vastleggen", () => {
    expect(moetVastleggen("Coulance tot €250 (vastleggen)")).toBe(true);
    expect(moetVastleggen("Een factuur tegenhouden als iets niet aantoonbaar klopt (reden vastleggen)")).toBe(true);
    expect(moetVastleggen("Scripts goedkeuren en versturen")).toBe(false);
    expect(zonderVastleggen("Coulance tot €250 (vastleggen)")).toBe("Coulance tot €250");
    expect(zonderVastleggen("Scripts goedkeuren en versturen")).toBe("Scripts goedkeuren en versturen");
  });

  it("verdeelt de bevoegdheden van Milou over beide groene niveaus", () => {
    const config = standaardConfig();
    const zelf = config.verantwoordelijkheden.filter((v) => v.persoon === "milou@shortclips.nl").flatMap((v) => v.bevoegdheden);
    expect(zelf.some(moetVastleggen)).toBe(true);
    expect(zelf.some((x) => !moetVastleggen(x))).toBe(true);
  });

  it("heeft vier niveaus: twee groen, één oranje, één rood", () => {
    expect(VIER_NIVEAUS.map((n) => n.kleur)).toEqual(["groen", "groen", "oranje", "rood"]);
  });
});
