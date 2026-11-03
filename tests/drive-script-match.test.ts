import { describe, expect, it } from "vitest";
import { decideBestMatch, scoreScriptFileForShoot, type ShootCandidate } from "@/server/captions/drive-script-score";

const shoot = { scheduledOn: "2026-11-12", title: "Opnamedag Koops — nov", clientName: "Koops Chalets" };

function cand(name: string, path: string | null): ShootCandidate {
  return { fileExternalId: name, fileName: name, filePath: path, result: scoreScriptFileForShoot(shoot, { name, path }) };
}

describe("scoreScriptFileForShoot", () => {
  it("zekere match: klantnaam + datum in de bestandsnaam → hoog", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "Koops Scripts 12-11.pdf" });
    expect(r.dateHit).toBe(true);
    expect(r.clientMatch).toBe(true);
    expect(r.confidence).toBe("hoog");
  });

  it("datum zonder klantnaam is géén zekere match (klantnaam ontbreekt)", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "Scripts 12-11.pdf" });
    expect(r.dateHit).toBe(true);
    expect(r.clientMatch).toBe(false);
    expect(r.confidence).toBe("middel");
  });

  it("herkent een geschreven datum met klantnaam (12 november)", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "Koops scripts 12 november.pdf" });
    expect(r.dateHit).toBe(true);
    expect(r.clientMatch).toBe(true);
    expect(r.confidence).toBe("hoog");
  });

  it("de klantnaam in het PAD telt ook mee", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "scripts 12-11.pdf", path: "Koops Chalets/Scripts/scripts 12-11.pdf" });
    expect(r.clientMatch).toBe(true);
    expect(r.dateHit).toBe(true);
    expect(r.confidence).toBe("hoog");
  });

  it("een script van een ándere klant matcht niet (geen klantnaam-treffer)", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "Shades Eric Kuster 12 november.pdf" });
    expect(r.clientMatch).toBe(false); // bevat 'koops'/'chalets' niet
  });

  it("niet-passend bestand → lage zekerheid", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "oud script 03-05.pdf" });
    expect(r.dateHit).toBe(false);
    expect(r.clientMatch).toBe(false);
    expect(r.confidence).toBe("laag");
  });

  it("verkeerde maand matcht niet", () => {
    const r = scoreScriptFileForShoot(shoot, { name: "Koops Scripts 12-10.pdf" });
    expect(r.dateHit).toBe(false);
  });
});

describe("decideBestMatch", () => {
  it("koppelt automatisch bij klantnaam + datum", () => {
    const d = decideBestMatch([cand("Koops Scripts 12-11.pdf", null), cand("iets anders.pdf", null)]);
    expect(d?.status).toBe("gekoppeld");
    expect(d?.best.fileName).toBe("Koops Scripts 12-11.pdf");
  });

  it("koppelt NOOIT een script van een andere klant — ook niet op dezelfde datum", () => {
    // Dit is precies de fout die we rechttrekken: een SHADES-script met de juiste
    // datum maar verkeerde klant mag niet aan deze (Koops-)opname hangen.
    const d = decideBestMatch([cand("Shades Eric Kuster 12-11.pdf", null)]);
    expect(d).toBeNull();
  });

  it("suggestie bij twee even sterke klant+datum-treffers (ambigu)", () => {
    const d = decideBestMatch([cand("Koops Scripts 12-11 deel 1.pdf", null), cand("Koops Scripts 12-11 deel 2.pdf", null)]);
    expect(d?.status).toBe("suggestie");
  });

  it("suggestie bij klantnaam zonder harde datum (alleen maand/periode)", () => {
    const d = decideBestMatch([cand("Koops scripts.pdf", "Koops/Scripts/November 2026/scripts.pdf")]);
    expect(d?.status).toBe("suggestie");
  });

  it("koppelt niets zonder klantnaam-treffer, ook niet met een datum", () => {
    expect(decideBestMatch([cand("Scripts 12-11.pdf", null)])).toBeNull();
    expect(decideBestMatch([cand("willekeurig.pdf", null)])).toBeNull();
  });
});
