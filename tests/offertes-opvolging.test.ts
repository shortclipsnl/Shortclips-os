import { describe, expect, it } from "vitest";
import {
  attentionSignals,
  canCreateLeadFrom,
  extractDealTerms,
  monthComparison,
  pakketFromTerms,
} from "@/lib/pandadoc";
import { isSimilarCompany } from "@/lib/onboarding-plan";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-16T10:00:00Z").getTime();
const ago = (d: number) => new Date(NOW - d * DAY);
const ahead = (d: number) => new Date(NOW + d * DAY);

describe("Afspraken uit de offertetekst", () => {
  it("leest pakket, looptijd en maandbedrag als ze eenduidig zijn", () => {
    const text = "Organische short video. 8 short video's per maand. Looptijd: minimaal 3 maanden. Investering € 2.950 excl. btw per maand.";
    const t = extractDealTerms(text, "Offerte - ZOCON - Shortclips.2026", 8850);
    expect(t).toEqual({ focus: "organisch", shortsPerMonth: 8, contractMonths: 3, monthlyExclVat: 2950, monthlySource: "tekst" });
    expect(pakketFromTerms(t)).toBe("org8");
  });

  it("berekent het maandbedrag alleen bij een rond totaal ÷ looptijd", () => {
    expect(extractDealTerms("Looptijd 3 maanden", "Advertentiecontent", 7470).monthlyExclVat).toBe(2490);
    expect(extractDealTerms("Looptijd 3 maanden", "Advertentiecontent", 7471).monthlyExclVat).toBeNull();
  });

  it("laat velden leeg bij tegenstrijdige waarden (niets verzinnen)", () => {
    const t = extractDealTerms("Optie A: 6 shorts per maand. Optie B: 8 shorts per maand.", "Offerte", null);
    expect(t.shortsPerMonth).toBeNull();
    expect(pakketFromTerms(t)).toBeNull();
  });

  it("kiest geen pakket zonder bekend type of bij afwijkende aantallen", () => {
    expect(pakketFromTerms({ focus: null, shortsPerMonth: 8 })).toBeNull();
    expect(pakketFromTerms({ focus: "advertentie", shortsPerMonth: 10 })).toBeNull();
    expect(pakketFromTerms({ focus: "advertentie", shortsPerMonth: 6 })).toBe("ads6");
  });
});

describe("Offertes die aandacht nodig hebben", () => {
  const base = { firstOpenedAt: null, lastOpenedAt: null, expiresOn: null };
  it("geeft één signaal per offerte, verlopen eerst", () => {
    const s = attentionSignals([
      { id: "a", status: "bekeken", sentAt: ago(10), firstOpenedAt: ago(2), lastOpenedAt: ago(1), expiresOn: ahead(3) },
      { id: "b", status: "bekeken", sentAt: ago(4), firstOpenedAt: ago(2), lastOpenedAt: ago(2), expiresOn: null },
      { id: "c", status: "verzonden", sentAt: ago(5), ...base },
      { id: "d", status: "verzonden", sentAt: ago(30), ...base, lastOpenedAt: null },
      { id: "e", status: "bekeken", sentAt: ago(20), firstOpenedAt: ago(19), lastOpenedAt: ago(19), expiresOn: null },
    ], NOW);
    expect(s.map((x) => [x.id, x.kind])).toEqual([
      ["a", "verloopt"], ["b", "recent_bekeken"], ["d", "niet_geopend"], ["c", "niet_geopend"], ["e", "lang_open"],
    ]);
  });

  it("negeert concepten, ondertekende, afgewezen en verlopen offertes", () => {
    const rows = ["concept", "ondertekend", "afgewezen", "verlopen"].map((status, i) => ({ id: String(i), status, sentAt: ago(30), ...base }));
    expect(attentionSignals(rows, NOW)).toEqual([]);
  });

  it("meldt een verse offerte niet", () => {
    expect(attentionSignals([{ id: "x", status: "verzonden", sentAt: ago(1), ...base }], NOW)).toEqual([]);
  });
});

describe("Maandvergelijking", () => {
  it("telt ondertekend en verzonden per kalendermaand", () => {
    const r = monthComparison([
      { status: "ondertekend", sentAt: "2026-10-20T10:00:00Z", signedAt: "2026-11-02T10:00:00Z" },
      { status: "ondertekend", sentAt: "2026-10-01T10:00:00Z", signedAt: "2026-10-10T10:00:00Z" },
      { status: "bekeken", sentAt: "2026-11-10T10:00:00Z", signedAt: null },
      { status: "afgewezen", sentAt: "2026-09-10T10:00:00Z", signedAt: null },
    ], new Date(NOW));
    expect(r).toEqual({ signedThis: 1, signedPrev: 1, sentThis: 1, sentPrev: 2 });
  });
});

describe("Lead aanmaken en twijfel", () => {
  it("maakt alleen een lead met bedrijf en extern e-mailadres", () => {
    expect(canCreateLeadFrom({ recipientCompany: "Zocon", recipientEmail: "info@zocon.nl" })).toBe(true);
    expect(canCreateLeadFrom({ recipientCompany: null, recipientEmail: "info@zocon.nl" })).toBe(false);
    expect(canCreateLeadFrom({ recipientCompany: "Zocon", recipientEmail: "jarno@shortclips.nl" })).toBe(false);
  });

  it("herkent een gelijkende lead als twijfel (dan geen nieuwe lead)", () => {
    expect(isSimilarCompany("Hoekstra Sneek", "Hoekstra")).toBe(true);
    expect(isSimilarCompany("Qbo Interieur", "Skodora")).toBe(false);
  });
});
