import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { bankAfschriften, bankTransacties } from "../../db/schema";
import { parseCamt053, round2, type CamtAfschrift } from "./camt";

/**
 * Leest één CAMT.053-bestand in. Idempotent:
 *  - transacties: uniek op (iban, ref) → al aanwezige boekingen worden
 *    overgeslagen, nooit dubbel geteld en nooit gewijzigd;
 *  - afschriftperiode: uniek op (iban, van, tot) → bij opnieuw inlezen
 *    worden alleen saldi en controle bijgewerkt.
 * Na de import controleren we per periode of de opgeslagen boekingen
 * aansluiten op begin- en eindsaldo van de bank.
 *
 * Geen `server-only`: ook gebruikt door scripts/bank-import.ts.
 */

export type BankImportResult = {
  bestand: string;
  afschriften: {
    iban: string;
    rekeningNaam: string;
    van: string;
    tot: string;
    gelezen: number;
    nieuw: number;
    alAanwezig: number;
    eindsaldo: number | null;
    controle: string;
    waarschuwingen: string[];
  }[];
};

export async function importCamtBestand(db: Db, bestand: string, content: string): Promise<BankImportResult> {
  const afschriften = parseCamt053(content);
  const out: BankImportResult = { bestand, afschriften: [] };
  for (const a of afschriften) out.afschriften.push(await importAfschrift(db, bestand, a));
  return out;
}

async function importAfschrift(db: Db, bestand: string, a: CamtAfschrift) {
  let nieuw = 0;
  const now = new Date();
  for (let i = 0; i < a.transacties.length; i += 300) {
    const chunk = a.transacties.slice(i, i + 300).map((t) => ({
      iban: t.iban,
      ref: t.ref,
      boekdatum: t.boekdatum,
      valutadatum: t.valutadatum,
      maand: t.boekdatum.slice(0, 7),
      bedrag: t.bedrag.toFixed(2),
      tegenpartij: t.tegenpartij,
      tegenrekening: t.tegenrekening,
      omschrijving: t.omschrijving,
      bankcode: t.bankcode,
      bronbestand: bestand.slice(0, 300),
      importedAt: now,
    }));
    const inserted = await db.insert(bankTransacties).values(chunk).onConflictDoNothing().returning({ id: bankTransacties.id });
    nieuw += inserted.length;
  }

  // Aansluiting: wat staat er nu in de database voor deze rekening en periode?
  const [som] = await db
    .select({
      n: sql<number>`count(*)::int`,
      netto: sql<number>`coalesce(sum(${bankTransacties.bedrag}), 0)::float`,
    })
    .from(bankTransacties)
    .where(and(eq(bankTransacties.iban, a.iban), sql`${bankTransacties.boekdatum} between ${a.van} and ${a.tot}`));
  const fouten = [...a.waarschuwingen];
  if (a.beginsaldo != null && a.eindsaldo != null) {
    const verwacht = round2(a.eindsaldo - a.beginsaldo);
    if (Math.abs(round2(som?.netto ?? 0) - verwacht) > 0.005) {
      fouten.push(`Opgeslagen mutaties (${round2(som?.netto ?? 0)}) sluiten niet aan op saldoverschil van de bank (${verwacht}).`);
    }
  }
  const controle = fouten.length ? fouten.join(" ") : `sluit (${som?.n ?? 0} boekingen)`;

  await db
    .insert(bankAfschriften)
    .values({
      iban: a.iban,
      rekeningNaam: a.rekeningNaam.slice(0, 120),
      van: a.van,
      tot: a.tot,
      beginsaldo: a.beginsaldo?.toFixed(2) ?? null,
      eindsaldo: a.eindsaldo?.toFixed(2) ?? null,
      aantal: a.aantal,
      totaalBij: a.totaalBij?.toFixed(2) ?? null,
      totaalAf: a.totaalAf?.toFixed(2) ?? null,
      bronbestand: bestand.slice(0, 300),
      controle,
      importedAt: now,
    })
    .onConflictDoUpdate({
      target: [bankAfschriften.iban, bankAfschriften.van, bankAfschriften.tot],
      set: {
        rekeningNaam: a.rekeningNaam.slice(0, 120),
        beginsaldo: a.beginsaldo?.toFixed(2) ?? null,
        eindsaldo: a.eindsaldo?.toFixed(2) ?? null,
        aantal: a.aantal,
        totaalBij: a.totaalBij?.toFixed(2) ?? null,
        totaalAf: a.totaalAf?.toFixed(2) ?? null,
        bronbestand: bestand.slice(0, 300),
        controle,
        importedAt: now,
        updatedAt: now,
      },
    });

  return {
    iban: a.iban,
    rekeningNaam: a.rekeningNaam,
    van: a.van,
    tot: a.tot,
    gelezen: a.transacties.length,
    nieuw,
    alAanwezig: a.transacties.length - nieuw,
    eindsaldo: a.eindsaldo,
    controle,
    waarschuwingen: a.waarschuwingen,
  };
}
