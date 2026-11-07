import { describe, expect, it } from "vitest";
import { parseCamt053 } from "../src/server/bank/camt";
import { deelIn } from "../src/server/bank/categorie";

const ntry = (ref: string, amt: string, ind: "DBIT" | "CRDT", naam: string, oms: string, dt = "2026-10-02") => `
<Ntry><Amt Ccy="EUR">${amt}</Amt><CdtDbtInd>${ind}</CdtDbtInd><RvslInd>false</RvslInd><Sts>BOOK</Sts>
<BookgDt><Dt>${dt}</Dt></BookgDt><ValDt><Dt>${dt}</Dt></ValDt><AcctSvcrRef>${ref}</AcctSvcrRef>
<BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>ICDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>
<NtryDtls><TxDtls><RltdPties>${ind === "DBIT" ? `<Cdtr><Nm>${naam}</Nm></Cdtr><CdtrAcct><Id><IBAN>NL04ADYB2017400157</IBAN></Id></CdtrAcct>` : `<Dbtr><Nm>${naam}</Nm></Dbtr><DbtrAcct><Id><IBAN>NL11RABO0123456789</IBAN></Id></DbtrAcct>`}</RltdPties>
<RmtInf><Ustrd>${oms}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`;

const doc = (entries: string, open = "100.00", close = "1050.00", n = 2, bij = "1000.00", af = "50.00") => `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<FrToDt><FrDtTm>2026-10-01T00:00:00Z</FrDtTm><ToDtTm>2026-10-31T23:59:59Z</ToDtTm></FrToDt>
<Acct><Id><IBAN>NL60KNAB0606428372</IBAN></Id><Ownr><Nm>Shortclips</Nm></Ownr></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${open}</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${close}</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<TxsSummry><TtlNtries><NbOfNtries>${n}</NbOfNtries></TtlNtries><TtlCdtNtries><Sum>${bij}</Sum></TtlCdtNtries><TtlDbtNtries><Sum>${af}</Sum></TtlDbtNtries></TxsSummry>
${entries}</Stmt></BkToCstmrStmt></Document>`;

describe("CAMT.053", () => {
  it("leest boekingen, tekens en saldi en sluit aan", () => {
    const [a] = parseCamt053(doc(ntry("r1", "1000.00", "CRDT", "Klant BV", "Factuur 2026-101") + ntry("r2", "50.00", "DBIT", "Coolblue", "bestelling &amp; levering")));
    expect(a!.iban).toBe("NL60KNAB0606428372");
    expect(a!.transacties.map((t) => t.bedrag)).toEqual([1000, -50]);
    expect(a!.transacties[1]!.tegenpartij).toBe("Coolblue");
    expect(a!.transacties[1]!.omschrijving).toBe("bestelling & levering");
    expect(a!.beginsaldo).toBe(100);
    expect(a!.eindsaldo).toBe(1050);
    expect(a!.waarschuwingen).toEqual([]);
  });

  it("signaleert een afschrift dat niet sluit", () => {
    const [a] = parseCamt053(doc(ntry("r1", "1000.00", "CRDT", "Klant", "x"), "100.00", "1050.00", 2, "1000.00", "50.00"));
    expect(a!.waarschuwingen.join(" ")).toMatch(/boekingen|sluit niet|wijken af/);
  });

  it("weigert een bestand dat geen CAMT.053 is", () => {
    expect(() => parseCamt053("<html></html>")).toThrow();
  });
});

describe("indeling", () => {
  it("bijschrijving is geen omzet maar ontvangst; eigen rekening is intern", () => {
    expect(deelIn({ bedrag: 2070, tegenpartij: "Klant BV", omschrijving: "factuur" }).groep).toBe("ontvangst");
    expect(deelIn({ bedrag: -5000, tegenpartij: "J. Klijnsma", omschrijving: "spaarrekening" }).groep).toBe("intern");
  });
  it("bekende leverancier houdt zijn Kostenmonitor-categorie", () => {
    const idx = new Map([["fabian media", { categorie: "Editors", groep: "editors", soort: "variabel" as const }]]);
    expect(deelIn({ bedrag: -900, tegenpartij: "Fabian Media", omschrijving: "" }, idx).categorie).toBe("Editors");
  });
  it("onbekend wordt Nog controleren", () => {
    expect(deelIn({ bedrag: -120, tegenpartij: "Xyz Onbekend", omschrijving: "" }).groep).toBe("controle");
  });
});
