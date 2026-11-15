import { describe, expect, it } from "vitest";
import { functieVoorRol, isoWeek, kaal, normaliseer, principeVanDeWeek, standaardVisie, verderSleutel } from "@/lib/visie/data";
import { standaardConfig } from "@/lib/verantwoordelijkheden/data";
import { editorMayOpenPath } from "@/lib/editor-routes";
import { videographerMayOpenPath } from "@/lib/videographer-routes";

describe("Onze visie: centrale bron", () => {
  const v = standaardVisie();

  it("start als voorstel, niet als vastgestelde tekst", () => {
    expect(v.status).toBe("voorstel");
    expect(v.vastgesteldOp).toBeNull();
    expect(v.openBesluiten.every((b) => !b.besloten)).toBe(true);
  });

  it("heeft de vijf kernprincipes uit het Visie Voorstel, elk met gewenst en ongewenst gedrag", () => {
    expect(v.principes.map((p) => p.titel)).toEqual([
      "Klaar is als het werkt", "Wij zijn de klant voor", "Cijfers sturen de volgende video", "Hun mensen, hun verhaal", "Eén keer goed",
    ]);
    for (const p of v.principes) {
      expect(p.uitleg && p.praktijk && p.wel && p.niet).toBeTruthy();
    }
  });

  it("blijft gelijk na opslaan en teruglezen", () => {
    expect(normaliseer(JSON.parse(JSON.stringify(v)))).toEqual(v);
  });

  it("valt terug op het voorstel bij lege of kapotte invoer", () => {
    expect(normaliseer(null).positionering).toBe(v.positionering);
    expect(normaliseer({ principes: [], missie: "" }).principes).toHaveLength(5);
    expect(normaliseer({ status: "iets anders" }).status).toBe("voorstel");
  });

  it("bevat geen gedachtestreepjes", () => {
    expect(JSON.stringify(v)).not.toMatch(/[–—]/);
  });

  it("haalt de markering weg voor het team", () => {
    expect(kaal("Norm [[90%]] halen")).toBe("Norm 90% halen");
  });

  it("wisselt het principe van de week op maandag en loopt alle principes langs", () => {
    const zondag = new Date(2026, 10, 15);
    const maandag = new Date(2026, 10, 16);
    expect(isoWeek(maandag)).toBe(isoWeek(zondag) + 1);
    expect(principeVanDeWeek(v, maandag)?.nr).not.toBe(principeVanDeWeek(v, zondag)?.nr);
    const gezien = new Set<number>();
    for (let w = 0; w < 5; w++) gezien.add(principeVanDeWeek(v, new Date(2026, 10, 16 + w * 7))!.nr);
    expect(gezien.size).toBe(5);
  });

  it("koppelt elke verantwoordelijkheid van Milou, Jiska en Rutger aan een principe", () => {
    const config = standaardConfig();
    const zonder = config.verantwoordelijkheden
      .filter((r) => /^(milou|jiska|rutger)@/.test(r.persoon) && !/facturatie/.test(r.id))
      .filter((r) => !v.verderDanDeTaak[verderSleutel(r.id)]);
    expect(zonder.map((r) => r.id)).toEqual([]);
    for (const x of Object.values(v.verderDanDeTaak)) expect(x.principe).toBeGreaterThanOrEqual(1);
    for (const x of Object.values(v.verderDanDeTaak)) expect(x.principe).toBeLessThanOrEqual(5);
  });

  it("kiest de functie bij de portaalrol", () => {
    expect(functieVoorRol("owner", false)).toBe("directie");
    expect(functieVoorRol("videographer", false)).toBe("videograaf");
    expect(functieVoorRol("editor", true)).toBe("editor");
    expect(functieVoorRol("project_coordinator", false)).toBe("content_creative");
  });

  it("is leesbaar voor editors en freelance videografen, het beheer niet via het menu", () => {
    expect(editorMayOpenPath("/visie")).toBe(true);
    expect(videographerMayOpenPath("/visie")).toBe(true);
    expect(videographerMayOpenPath("/visie/beheer")).toBe(false);
    expect(editorMayOpenPath("/kennisbank")).toBe(false);
  });
});
