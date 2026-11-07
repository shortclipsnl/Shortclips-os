import { date, index, integer, numeric, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";

/* ------------------------------------------------------------------ *
 * Bankmutaties — elke afzonderlijke transactie van de zakelijke
 * Knab-rekeningen, ingelezen uit de officiële CAMT.053-export van Knab.
 *
 * Bewust GEEN omzet of kosten: dit is cashflow. Omzet komt uit de
 * boekhouding (DigiBoox), kosten uit de Kostenmonitor. De transacties
 * dienen om te controleren waar het geld daadwerkelijk heen ging.
 *
 * Dubbel importeren is onmogelijk: (iban, ref) is uniek. `ref` is de
 * unieke bankreferentie (AcctSvcrRef) die Knab per boeking meegeeft.
 * ------------------------------------------------------------------ */

export const bankTransacties = pgTable(
  "bank_transacties",
  {
    id: pk(),
    iban: varchar("iban", { length: 34 }).notNull(),
    /** Unieke bankreferentie (AcctSvcrRef); bij ontbreken een hash van de boeking. */
    ref: varchar("ref", { length: 80 }).notNull(),
    boekdatum: date("boekdatum").notNull(),
    valutadatum: date("valutadatum"),
    /** YYYY-MM van de boekdatum, voor snelle maandselecties. */
    maand: varchar("maand", { length: 7 }).notNull(),
    /** Positief = bijgeschreven, negatief = afgeschreven. */
    bedrag: numeric("bedrag", { precision: 12, scale: 2 }).notNull(),
    tegenpartij: varchar("tegenpartij", { length: 200 }).notNull().default(""),
    tegenrekening: varchar("tegenrekening", { length: 40 }).notNull().default(""),
    omschrijving: text("omschrijving").notNull().default(""),
    /** Banktransactiecode, bijv. PMNT/ICDT/ESCT. */
    bankcode: varchar("bankcode", { length: 40 }).notNull().default(""),
    bronbestand: varchar("bronbestand", { length: 300 }).notNull().default(""),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique("bank_transacties_iban_ref_unique").on(t.iban, t.ref),
    index("bank_transacties_maand_idx").on(t.maand),
    index("bank_transacties_boekdatum_idx").on(t.boekdatum),
  ],
);

/**
 * Eén ingelezen afschriftperiode per rekening: begin- en eindsaldo en de
 * controletotalen van de bank. Hiermee controleren we of alle transacties
 * compleet zijn (beginsaldo + mutaties = eindsaldo) en tonen we de
 * actuele saldi en de datum van de laatste synchronisatie.
 */
export const bankAfschriften = pgTable(
  "bank_afschriften",
  {
    id: pk(),
    iban: varchar("iban", { length: 34 }).notNull(),
    rekeningNaam: varchar("rekening_naam", { length: 120 }).notNull().default(""),
    van: date("van").notNull(),
    tot: date("tot").notNull(),
    beginsaldo: numeric("beginsaldo", { precision: 12, scale: 2 }),
    eindsaldo: numeric("eindsaldo", { precision: 12, scale: 2 }),
    /** Aantal boekingen en totalen volgens de bank (ter controle). */
    aantal: integer("aantal").notNull().default(0),
    totaalBij: numeric("totaal_bij", { precision: 12, scale: 2 }),
    totaalAf: numeric("totaal_af", { precision: 12, scale: 2 }),
    bronbestand: varchar("bronbestand", { length: 300 }).notNull().default(""),
    /** Uitkomst van de aansluiting na import: "sluit" of een foutmelding. */
    controle: text("controle").notNull().default(""),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [unique("bank_afschriften_iban_periode_unique").on(t.iban, t.van, t.tot)],
);
