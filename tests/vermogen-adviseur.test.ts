import { describe, expect, it } from "vitest";
import { controleerGetallen, parseAdvies, vindGetallen, type Advies, type Feitenblad } from "@/server/vermogen/adviseur-core";

const feiten: Feitenblad = {
  versie: 1,
  datum: "2026-11-10",
  bronnen: [{ label: "DEGIRO-export", datum: "2026-10-17" }],
  feiten: [
    { id: "btw_tekort", label: "Btw Q4 nog apart te zetten", waarde: 6537, eenheid: "EUR" },
    { id: "crypto_pct", label: "Crypto als deel van beleggingen", waarde: 30.2, eenheid: "%" },
    { id: "crypto_boven", label: "Crypto boven limiet", waarde: 1978.9, eenheid: "EUR" },
  ],
  posities: [{ product: "Bitcoin (crypto)", rekening: "DEGIRO", soort: "crypto", valuta: "EUR", waarde: 1804.1, gewicht: 18.4 }],
  regelchecks: [{ regel: "Crypto max 10%", gehaald: false, toelichting: "30,2% van beleggingen" }],
  waarschuwingen: [],
};

const basis: Advies = {
  samenvatting: "Zet eerst € 6.537 apart voor de btw.",
  gezondheid: { oordeel: "Redelijk", toelichting: "Crypto is 30,2% van je beleggingen." },
  goed: [],
  aandacht: ["Crypto 30% boven je limiet van 10%"],
  kansen: [],
  acties: [{ prioriteit: 1, titel: "Btw apart", actie: "Zet € 6.537 apart vóór 31 januari 2027", waarom: "", voordeel: "", risico: "", data: "Saldi 31-10-2026", effect: "" }],
  aandelen: [{ product: "Bitcoin (crypto)", oordeel: "Verkleinen", onderbouwing: "18,4% in één coin", voorstel: "Verkoop € 1.979" }],
  nietsDoen: null,
};

describe("vermogensadviseur: getallen", () => {
  it("leest Nederlandse bedragen en percentages", () => {
    const g = vindGetallen("€ 6.537 en 17,5% en 1.234,50");
    expect(g.map((x) => [x.waarde, x.soort])).toEqual([[6537, "EUR"], [17.5, "%"], [1234.5, "getal"]]);
  });

  it("keurt een advies goed waarvan elk getal in het feitenblad staat", () => {
    expect(controleerGetallen(basis, feiten, null)).toEqual([]);
  });

  it("blokkeert een zelf berekend getal", () => {
    const fout = { ...basis, samenvatting: "Je mist € 8.000 aan belastinggeld." };
    expect(controleerGetallen(fout, feiten, null)).toHaveLength(1);
  });

  it("blokkeert een verzonnen percentage", () => {
    const fout = { ...basis, aandacht: ["Crypto is 45% van je beleggingen"] };
    expect(controleerGetallen(fout, feiten, null)[0]).toContain("45%");
  });
});

describe("vermogensadviseur: antwoord uitlezen", () => {
  it("haalt JSON uit een codeblok en begrenst tot 5 acties", () => {
    const acties = Array.from({ length: 7 }, (_, i) => ({ titel: `A${i}` }));
    const a = parseAdvies("```json\n" + JSON.stringify({ ...basis, acties, aandelen: [{ product: "X", oordeel: "Kopen" }] }) + "\n```");
    expect(a.acties).toHaveLength(5);
    expect(a.acties[4]!.prioriteit).toBe(5);
    expect(a.aandelen[0]!.oordeel).toBe("Nader onderzoeken");
  });
});
