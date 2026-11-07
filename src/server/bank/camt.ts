import { createHash } from "node:crypto";

/**
 * Parser voor de officiële CAMT.053-export (ISO 20022) van Knab.
 *
 * Geen `server-only`: wordt ook door het importscript (tsx) en de tests gebruikt.
 * Het bestand is een niet-vertrouwde download: we lezen het puur als data,
 * verzinnen geen getallen en geven waarschuwingen terug als iets niet klopt.
 */

export type CamtTransactie = {
  iban: string;
  ref: string;
  boekdatum: string; // YYYY-MM-DD
  valutadatum: string | null;
  bedrag: number; // + bij, - af
  tegenpartij: string;
  tegenrekening: string;
  omschrijving: string;
  bankcode: string;
};

export type CamtAfschrift = {
  iban: string;
  rekeningNaam: string;
  van: string;
  tot: string;
  beginsaldo: number | null;
  eindsaldo: number | null;
  aantal: number;
  totaalBij: number | null;
  totaalAf: number | null;
  transacties: CamtTransactie[];
  waarschuwingen: string[];
};

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();

/** Eerste inhoud van <tag>…</tag> binnen een stuk XML (zonder namespaces). */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? m[1]! : null;
}
function all(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]!);
  return out;
}
const txt = (xml: string | null, name: string) => (xml ? decode(tag(xml, name) ?? "") : "");
const num = (s: string | null | undefined) => {
  if (s == null || s.trim() === "") return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
};
const dateOnly = (s: string) => (/^\d{4}-\d{2}-\d{2}/.exec(s)?.[0] ?? "");

function saldo(stmt: string, code: string): number | null {
  for (const bal of all(stmt, "Bal")) {
    if (txt(bal, "Cd") !== code) continue;
    const amt = num(/<(?:\w+:)?Amt[^>]*>([^<]+)</.exec(bal)?.[1]);
    if (amt == null) return null;
    return txt(bal, "CdtDbtInd") === "DBIT" ? -amt : amt;
  }
  return null;
}

export function isCamt053(content: string): boolean {
  return /camt\.053/i.test(content.slice(0, 2000)) && /<(?:\w+:)?BkToCstmrStmt/.test(content);
}

/** Leest alle afschriften (één per rekening/periode) uit een CAMT.053-bestand. */
export function parseCamt053(content: string): CamtAfschrift[] {
  if (!isCamt053(content)) throw new Error("Dit is geen CAMT.053-bestand (Knab: Exporteren, formaat CAMT.053).");
  const result: CamtAfschrift[] = [];

  for (const stmt of all(content, "Stmt")) {
    const waarschuwingen: string[] = [];
    const acct = tag(stmt, "Acct") ?? "";
    // Betaalrekeningen hebben een IBAN; Knab-spaarrekeningen alleen een rekeningnummer (Othr/Id).
    const iban = (txt(acct, "IBAN") || txt(tag(acct, "Othr"), "Id")).replace(/<[^>]+>/g, "").replace(/\s/g, "").toUpperCase();
    if (!iban) {
      waarschuwingen.push("Afschrift zonder IBAN overgeslagen.");
      continue;
    }
    const rekeningNaam = txt(tag(acct, "Ownr"), "Nm");
    const frTo = tag(stmt, "FrToDt") ?? "";
    let van = dateOnly(txt(frTo, "FrDtTm"));
    let tot = dateOnly(txt(frTo, "ToDtTm"));

    const summ = tag(stmt, "TxsSummry");
    const aantal = Number(txt(summ ? tag(summ, "TtlNtries") : null, "NbOfNtries")) || 0;
    const totaalBij = num(txt(summ ? tag(summ, "TtlCdtNtries") : null, "Sum"));
    const totaalAf = num(txt(summ ? tag(summ, "TtlDbtNtries") : null, "Sum"));

    const transacties: CamtTransactie[] = [];
    for (const ntry of all(stmt, "Ntry")) {
      const status = txt(ntry, "Sts");
      if (status && status !== "BOOK") continue; // alleen definitief geboekte posten
      const amt = num(/<(?:\w+:)?Amt[^>]*>([^<]+)</.exec(ntry)?.[1]);
      if (amt == null) {
        waarschuwingen.push("Boeking zonder geldig bedrag overgeslagen.");
        continue;
      }
      const debit = txt(ntry, "CdtDbtInd") === "DBIT";
      const reversal = txt(ntry, "RvslInd") === "true";
      const sign = (debit ? -1 : 1) * (reversal ? -1 : 1);
      const boekdatum = dateOnly(txt(tag(ntry, "BookgDt"), "Dt") || txt(tag(ntry, "BookgDt"), "DtTm"));
      const valutadatum = dateOnly(txt(tag(ntry, "ValDt"), "Dt")) || null;
      const tx = tag(ntry, "TxDtls") ?? "";
      const parties = tag(tx, "RltdPties") ?? "";
      // Bij een afschrijving is de tegenpartij de crediteur, bij een bijschrijving de debiteur.
      const cp = debit ? (tag(parties, "Cdtr") ?? "") : (tag(parties, "Dbtr") ?? "");
      const cpAcct = debit ? (tag(parties, "CdtrAcct") ?? "") : (tag(parties, "DbtrAcct") ?? "");
      const tegenpartij = txt(cp, "Nm");
      const tegenrekening = (txt(cpAcct, "IBAN") || txt(cpAcct, "Id")).replace(/<[^>]+>/g, "").replace(/\s/g, "");
      const rmt = tag(tx, "RmtInf") ?? "";
      const omschrijving = [...all(rmt, "Ustrd").map(decode), txt(rmt, "Ref")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      const domn = tag(ntry, "Domn") ?? "";
      const bankcode = [txt(domn, "Cd"), txt(tag(domn, "Fmly"), "Cd"), txt(domn, "SubFmlyCd")].filter(Boolean).join("/");
      const bankRef = txt(ntry, "AcctSvcrRef") || txt(tx, "AcctSvcrRef");
      const ref =
        bankRef ||
        "h:" +
          createHash("sha256")
            .update([iban, boekdatum, valutadatum, sign * amt, tegenpartij, tegenrekening, omschrijving].join("|"))
            .digest("hex")
            .slice(0, 40);
      if (!boekdatum) {
        waarschuwingen.push(`Boeking ${ref} zonder boekdatum overgeslagen.`);
        continue;
      }
      transacties.push({
        iban,
        ref: ref.slice(0, 80),
        boekdatum,
        valutadatum,
        bedrag: Math.round(sign * amt * 100) / 100,
        tegenpartij: tegenpartij.slice(0, 200),
        tegenrekening: tegenrekening.slice(0, 40),
        omschrijving,
        bankcode: bankcode.slice(0, 40),
      });
    }

    if (!van && transacties.length) van = transacties.map((t) => t.boekdatum).sort()[0]!;
    if (!tot && transacties.length) tot = transacties.map((t) => t.boekdatum).sort().at(-1)!;

    const beginsaldo = saldo(stmt, "OPBD") ?? saldo(stmt, "PRCD");
    const eindsaldo = saldo(stmt, "CLBD");

    // Controle 1: aantal en totalen tegen de samenvatting van de bank.
    if (aantal && aantal !== transacties.length) {
      waarschuwingen.push(`Bank meldt ${aantal} boekingen, ingelezen ${transacties.length}.`);
    }
    const bij = round2(transacties.filter((t) => t.bedrag > 0).reduce((a, t) => a + t.bedrag, 0));
    const af = round2(-transacties.filter((t) => t.bedrag < 0).reduce((a, t) => a + t.bedrag, 0));
    if (totaalBij != null && Math.abs(totaalBij - bij) > 0.005) waarschuwingen.push(`Bijschrijvingen ${bij} wijken af van bank (${totaalBij}).`);
    if (totaalAf != null && Math.abs(totaalAf - af) > 0.005) waarschuwingen.push(`Afschrijvingen ${af} wijken af van bank (${totaalAf}).`);
    // Controle 2: beginsaldo + mutaties = eindsaldo.
    if (beginsaldo != null && eindsaldo != null && Math.abs(round2(beginsaldo + bij - af) - eindsaldo) > 0.005) {
      waarschuwingen.push(`Saldo sluit niet: begin ${beginsaldo} + mutaties ${round2(bij - af)} ≠ eind ${eindsaldo}.`);
    }

    result.push({ iban, rekeningNaam, van, tot, beginsaldo, eindsaldo, aantal: transacties.length, totaalBij, totaalAf, transacties, waarschuwingen });
  }
  if (result.length === 0) throw new Error("Geen afschriften gevonden in dit bestand.");
  return result;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
