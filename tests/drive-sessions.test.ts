import { describe, expect, it } from "vitest";
import { buildDriveSessions, isScriptPdf, parseSessionName, sessionMatchesShoot, type DriveEntry } from "@/lib/drive-sessions";

/**
 * Sessiemappen uit Drive: opgebouwd naar de echte mapstructuur van klanten
 * (2. SHORT VIDEO SCRIPTS / jaar / SESSIE n - datum / bestanden), inclusief de
 * rommel die er in de praktijk tussen staat (PPTX, Word, Google Docs, "._").
 */

let seq = 0;
function folder(name: string, parent: string | null, modifiedAt = "2026-10-01T10:00:00Z"): DriveEntry {
  return { externalId: `f-${name}-${seq++}`, parentExternalId: parent, name, path: null, isFolder: true, mimeType: "application/vnd.google-apps.folder", url: null, modifiedAt };
}
function file(name: string, parent: string, mimeType: string, modifiedAt = "2026-10-01T10:00:00Z"): DriveEntry {
  return { externalId: `x-${name}-${seq++}`, parentExternalId: parent, name, path: null, isFolder: false, mimeType, url: `https://drive.google.com/${name}`, modifiedAt };
}
const PDF = "application/pdf";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GDOC = "application/vnd.google-apps.document";

describe("sessienamen lezen", () => {
  it("haalt nummer, dag en maand uit de mapnaam", () => {
    expect(parseSessionName("SESSIE 8 - 11 NOVEMBER")).toEqual({ number: 8, day: 11, month: 11 });
    expect(parseSessionName("SESSIE 12 - 23 SEP")).toEqual({ number: 12, day: 23, month: 9 });
    expect(parseSessionName("SESSIE 1 - 26 MAART ")).toEqual({ number: 1, day: 26, month: 3 });
    expect(parseSessionName("SESSIE 8 - 06 OKTOBER")).toEqual({ number: 8, day: 6, month: 10 });
  });
  it("leest alleen een maand als er geen dag staat, en nooit het sessienummer als dag", () => {
    expect(parseSessionName("SESSIE 1 - APRIL")).toEqual({ number: 1, day: null, month: 4 });
    expect(parseSessionName("SESSIE 2 -MEI")).toEqual({ number: 2, day: null, month: 5 });
    expect(parseSessionName("Sessie 3")).toEqual({ number: 3, day: null, month: null });
    expect(parseSessionName("Sessie December")).toEqual({ number: null, day: null, month: 12 });
  });
});

describe("alleen PDF's", () => {
  it("weigert PowerPoint, Word, Google Docs en macOS-restbestanden", () => {
    expect(isScriptPdf({ name: "Scripts.pdf", mimeType: PDF, isFolder: false })).toBe(true);
    expect(isScriptPdf({ name: "Scripts.pptx", mimeType: PPTX, isFolder: false })).toBe(false);
    expect(isScriptPdf({ name: "Scripts.docx", mimeType: DOCX, isFolder: false })).toBe(false);
    expect(isScriptPdf({ name: "365werk concepten", mimeType: GDOC, isFolder: false })).toBe(false);
    expect(isScriptPdf({ name: "._Short video scripts.pdf", mimeType: PDF, isFolder: false })).toBe(false);
  });
});

describe("sessiemappen opbouwen", () => {
  const root = folder("2. SHORT VIDEO SCRIPTS", null);
  const y2025 = folder("2025", root.externalId);
  const y2026 = folder("2026", root.externalId);
  const s1 = folder("SESSIE 1 - 26 MAART ", y2026.externalId);
  const s3 = folder("SESSIE 3 - 2 NOVEMBER", y2026.externalId);
  const s2 = folder("SESSIE 2 - 29 MEI", y2026.externalId);
  const s4 = folder("SESSIE 4 - 15 DECEMBER", y2026.externalId); // nog leeg
  const s3ads = folder("ADS", s3.externalId);
  const old1 = folder("Sessie 1", y2025.externalId);
  const entries: DriveEntry[] = [
    root, y2025, y2026, s1, s2, s3, s4, s3ads, old1,
    file("Short video script - Final.pdf", s1.externalId, PDF),
    file("Short video script - Final.pptx", s1.externalId, PPTX),
    file("Besparingstool.docx", s1.externalId, DOCX),
    file("Script MEI.pdf", s2.externalId, PDF),
    file("Script MEI.pptx", s2.externalId, PPTX),
    file("Organische Scripts.pdf", s3.externalId, PDF, "2026-10-28T09:00:00Z"),
    file("Organische Scripts.pptx", s3.externalId, PPTX),
    file("Ads Scripts.pdf", s3ads.externalId, PDF, "2026-10-29T09:00:00Z"),
    file("Oud script.pdf", old1.externalId, PDF, "2025-04-01T09:00:00Z"),
    // Losse PDF's in de jaarmap zelf (geen sessiemap), zoals bij Auto Christiaan.
    file("Short video scripts - 7 mei.pdf", y2025.externalId, PDF, "2025-05-06T09:00:00Z"),
    file("._Short video scripts - 7 mei.pdf", y2025.externalId, PDF),
  ];
  const sessions = buildDriveSessions(entries);
  const sessie = sessions.filter((s) => s.kind === "sessie");

  it("toont de sessiemappen met de nieuwste bovenaan", () => {
    expect(sessie.map((s) => s.name)).toEqual([
      "SESSIE 4 - 15 DECEMBER",
      "SESSIE 3 - 2 NOVEMBER",
      "SESSIE 2 - 29 MEI",
      "SESSIE 1 - 26 MAART",
      "Sessie 1",
    ]);
  });

  it("geeft datum, jaar en de bovenliggende mappen mee", () => {
    const nov = sessie.find((s) => s.name.startsWith("SESSIE 3"))!;
    expect(nov.date).toBe("2026-11-02");
    expect(nov.dateLabel).toBe("2 nov 2026");
    expect(nov.parentLabel).toBe("2. SHORT VIDEO SCRIPTS / 2026");
  });

  it("toont binnen een sessie uitsluitend PDF's, ook uit submappen (met label)", () => {
    const nov = sessie.find((s) => s.name.startsWith("SESSIE 3"))!;
    expect(nov.pdfs.map((p) => [p.name, p.subfolder])).toEqual([
      ["Ads Scripts.pdf", "ADS"],
      ["Organische Scripts.pdf", null],
    ]);
    const maart = sessie.find((s) => s.name.startsWith("SESSIE 1 -"))!;
    expect(maart.pdfs.map((p) => p.name)).toEqual(["Short video script - Final.pdf"]);
    for (const s of sessions) for (const p of s.pdfs) expect(p.name.toLowerCase().endsWith(".pdf")).toBe(true);
  });

  it("laat lege sessiemappen zien (nog geen PDF) en niet de ADS-submap als eigen sessie", () => {
    expect(sessie.find((s) => s.name.startsWith("SESSIE 4"))!.pdfs).toHaveLength(0);
    expect(sessions.some((s) => s.name === "ADS")).toBe(false);
  });

  it("zet losse PDF's buiten sessiemappen onder 'overige map', zonder ._-bestanden", () => {
    const other = sessions.filter((s) => s.kind === "map");
    expect(other.map((s) => s.name)).toEqual(["2025"]);
    expect(other[0]!.pdfs.map((p) => p.name)).toEqual(["Short video scripts - 7 mei.pdf"]);
  });

  it("leidt het jaar af uit de wijzigdatum als er geen jaarmap is", () => {
    const r = folder("2. SHORT VIDEO SCRIPTS", null);
    const april = folder("SESSIE 1 - APRIL", r.externalId, "2026-04-02T10:00:00Z");
    const nov = folder("SESSIE 8 - 11 NOVEMBER", r.externalId, "2026-11-01T10:00:00Z");
    const out = buildDriveSessions([r, april, nov, file("a.pdf", april.externalId, PDF, "2026-04-02T10:00:00Z")]);
    expect(out.map((s) => [s.name, s.dateLabel])).toEqual([
      ["SESSIE 8 - 11 NOVEMBER", "11 nov 2026"],
      ["SESSIE 1 - APRIL", "april 2026"],
    ]);
  });
});

describe("sessie bij opname", () => {
  it("herkent een passende en een afwijkende sessie", () => {
    expect(sessionMatchesShoot({ date: "2026-11-11", datePrecision: "dag" }, "2026-11-11")).toBe("match");
    expect(sessionMatchesShoot({ date: "2026-11-09", datePrecision: "dag" }, "2026-11-11")).toBe("match");
    expect(sessionMatchesShoot({ date: "2026-07-21", datePrecision: "dag" }, "2026-11-11")).toBe("mismatch");
    expect(sessionMatchesShoot({ date: "2026-11-01", datePrecision: "maand" }, "2026-11-20")).toBe("match");
    expect(sessionMatchesShoot({ date: null, datePrecision: null }, "2026-11-20")).toBe("onbekend");
  });
});
