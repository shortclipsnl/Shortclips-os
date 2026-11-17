import { describe, expect, it } from "vitest";
import { cleanScriptText, normalizeStyle, pickStyleFiles, styleFingerprint, styleToText } from "@/server/content-research/style-core";

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
