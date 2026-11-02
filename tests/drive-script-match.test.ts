import { describe, expect, it } from "vitest";
import { decideBestMatch, scoreScriptFileForShoot, type ShootCandidate } from "@/server/captions/drive-script-score";

const shoot = { scheduledOn: "2026-11-12", title: "Opnamedag Koops — nov", clientName: "Koops" };

function cand(name: string, path: string | null): ShootCandidate {
  return { fileExternalId: name, fileName: name, filePath: path, result: scoreScriptFileForShoot(shoot, { name, path }) };
}

describe("scoreScriptFileForShoot", () => {
  it("herkent een datum (dag-maand) in de bestandsnaam als zekere match", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "Scripts 12-11.pdf" });
    expect(r.dateHit).toBe(true);
    expect(r.confidence).toBe("hoog");
  });

  it("herkent een geschreven datum (12 november)", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "Koops scripts 12 november.pdf" });
    expect(r.dateHit).toBe(true);
    expect(r.confidence).toBe("hoog");
  });

  it("herkent het ISO-formaat in een pad", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "scripts.pdf", path: "Scripts/2026-11-12/scripts.pdf" });
    expect(r.dateHit).toBe(true);
  });

  it("herkent een afwijkende naam met dezelfde datum ('iets afwijkt')", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "def versie SCRIPT koops (12-11-2026).pdf" });
    expect(r.dateHit).toBe(true);
    expect(r.confidence).toBe("hoog");
  });

  it("geeft alleen een maand/periode-map middelzekerheid (geen harde datum)", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "scripts.pdf", path: "Scripts/November 2026/scripts.pdf" });
    expect(r.dateHit).toBe(false);
    expect(r.confidence).toBe("middel");
  });

  it("geeft een niet-passend bestand lage zekerheid", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "oud script 03-05.pdf" });
    expect(r.dateHit).toBe(false);
    expect(r.confidence).toBe("laag");
  });

  it("matcht de verkeerde maand niet", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "Scripts 12-10.pdf" });
    expect(r.dateHit).toBe(false);
  });
});

describe("decideBestMatch", () => {
  it("koppelt automatisch bij één duidelijke datumtreffer", () => {
    const d = decideBestMatch([cand("Scripts 12-11.pdf", null), cand("iets anders.pdf", null)]);
    expect(d?.status).toBe("gekoppeld");
    expect(d?.best.fileName).toBe("Scripts 12-11.pdf");
  });

  it("maakt er een suggestie van bij twee even sterke datumtreffers (ambigu)", () => {
    const d = decideBestMatch([cand("Scripts 12-11 deel 1.pdf", null), cand("Scripts 12-11 deel 2.pdf", null)]);
    expect(d?.status).toBe("suggestie");
  });

  it("maakt er een suggestie van bij alleen zwakkere aanwijzingen", () => {
    const d = decideBestMatch([cand("scripts.pdf", "Scripts/November 2026/scripts.pdf")]);
    expect(d?.status).toBe("suggestie");
  });

  it("koppelt niets als er geen aanwijzingen zijn", () => {
    expect(decideBestMatch([cand("willekeurig.pdf", null)])).toBeNull();
  });
});
