import { describe, expect, it } from "vitest";
import {
  allowedManualStatuses,
  companyFromTitle,
  conversionRate,
  emailDomain,
  extractTotalFromText,
  findEuroAmounts,
  isInternalEmail,
  mapPandaDocStatus,
  normalizeCompany,
  parseEuro,
  serviceTypeFrom,
} from "@/lib/pandadoc";

describe("PandaDoc-status", () => {
  it("vertaalt API- en weergavevormen naar de portaalstatus", () => {
    expect(mapPandaDocStatus("document.draft")).toBe("concept");
    expect(mapPandaDocStatus("document.sent")).toBe("verzonden");
    expect(mapPandaDocStatus("Viewed")).toBe("bekeken");
    expect(mapPandaDocStatus("document.completed")).toBe("ondertekend");
    expect(mapPandaDocStatus("document.declined")).toBe("afgewezen");
    expect(mapPandaDocStatus("document.voided")).toBe("verlopen");
    expect(mapPandaDocStatus("Waiting for approval")).toBe("concept");
    expect(mapPandaDocStatus(undefined)).toBe("concept");
  });

  it("biedt alleen handmatige wijzigingen die PandaDoc toestaat en zinvol zijn", () => {
    expect(allowedManualStatuses("bekeken")).toEqual(["ondertekend", "afgewezen", "verlopen"]);
    expect(allowedManualStatuses("concept")).toEqual([]);
    expect(allowedManualStatuses("ondertekend")).toEqual([]);
  });
});

describe("Bedrag uit de offertetekst", () => {
  it("leest Nederlandse notatie", () => {
    expect(parseEuro("10.708,50")).toBe(10708.5);
    expect(parseEuro("8.850")).toBe(8850);
    expect(parseEuro("624,75")).toBe(624.75);
    expect(parseEuro("abc")).toBeNull();
  });

  it("vindt het totaal alleen als excl. en incl. btw elkaar bevestigen (echte ZOCON-offerte)", () => {
    const text = "Offerte 2026 500M+ 50+ 9 45 min Short content afdeling € 8.850 3 maanden, daarna maandelijks opzegbaar. ZOCON Femke · 10-11-2026 € 10.708,50 € 1.858,50";
    expect(findEuroAmounts(text)).toEqual([8850, 10708.5, 1858.5]);
    expect(extractTotalFromText(text)).toEqual({ exclVat: 8850, inclVat: 10708.5 });
  });

  it("werkt ook voor de advertentieofferte (echte OSW-offerte)", () => {
    const text = "Short video advertentie Creatives € 2.975 excl. btw € 624,75 € 3.599,75 OSW Thijs";
    expect(extractTotalFromText(text)).toEqual({ exclVat: 2975, inclVat: 3599.75 });
  });

  it("verzint geen bedrag zonder btw-bevestiging", () => {
    expect(extractTotalFromText("Organisch 6 € 2.325 p/m")).toBeNull();
    expect(extractTotalFromText("")).toBeNull();
  });
});

describe("Klantherkenning", () => {
  it("haalt de bedrijfsnaam uit de documenttitel", () => {
    expect(companyFromTitle("Offerte - ZOCON - Shortclips.2026")).toBe("ZOCON");
    expect(companyFromTitle("Offerte - Bizziphone - Shortclips Advertentie creatives")).toBe("Bizziphone");
    expect(companyFromTitle("Offerte - Shortclips - Aquacell - Advertentie creatives")).toBe("Aquacell");
    expect(companyFromTitle("Offerte - Van der let & Partners - Shortclips.2026")).toBe("Van der let & Partners");
    expect(companyFromTitle("Offerte - KKFH - Shortclips - 2026")).toBe("KKFH");
    expect(companyFromTitle("Offerte - Shortclips Advertentie creatives (1)")).toBeNull();
  });

  it("bepaalt het type dienstverlening alleen bij een duidelijk signaal", () => {
    expect(serviceTypeFrom("Offerte - Slimglass - Shortclips Advertentie creatives")).toBe("Advertentiecreatives");
    expect(serviceTypeFrom("Offerte - ZOCON - Shortclips.2026", "Short content afdeling € 8.850")).toBe("Organische short video");
    expect(serviceTypeFrom("Offerte - X - Shortclips.2026", "")).toBeNull();
  });

  it("normaliseert bedrijfsnamen en e-maildomeinen", () => {
    expect(normalizeCompany("Zocon B.V.")).toBe(normalizeCompany("ZOCON"));
    expect(normalizeCompany("Van der Let & Partners")).toBe("vanderletenpartners");
    expect(emailDomain("Femke@Zocon.eu")).toBe("zocon.eu");
    expect(isInternalEmail("info@shortclips.nl")).toBe(true);
    expect(isInternalEmail("femke@zocon.eu")).toBe(false);
  });
});

describe("Conversie", () => {
  it("rekent alleen met afgeronde offertes", () => {
    expect(conversionRate({ ondertekend: 2, afgewezen: 1, verlopen: 1 })).toBe(0.5);
    expect(conversionRate({ ondertekend: 0, afgewezen: 0, verlopen: 0 })).toBeNull();
  });
});
