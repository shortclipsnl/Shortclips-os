import { date, index, integer, numeric, pgTable, unique, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";

/* ------------------------------------------------------------------ *
 * Kostenmonitor — alle afschrijvingen van de zakelijke rekening
 * (Knab via DigiBoox), per maand/categorie/leverancier. Voedt de
 * eigenaar-pagina /kosten, functioneel gelijk aan de losse Kostenmonitor.
 *
 * Bewust denormaal (leverancier- en categorie-NAAM per regel): de bron is
 * een maandelijkse export en de indeling (17 vaste categorieën) ligt vast,
 * dus er is geen aparte dimensietabel nodig. Dat houdt de import simpel en
 * idempotent: per maand verwijderen en opnieuw invoegen.
 * ------------------------------------------------------------------ */

/** Eén regel = één leverancier binnen één subcategorie in één maand. */
export const kostenRegels = pgTable(
  "kosten_regels",
  {
    id: pk(),
    /** Maand als YYYY-MM. */
    maand: varchar("maand", { length: 7 }).notNull(),
    /** Leveranciersnaam zoals in DigiBoox. */
    leverancier: varchar("leverancier", { length: 200 }).notNull(),
    /** Subcategorie, bijv. "Lonen", "Editors", "Software en tools". */
    subcategorie: varchar("subcategorie", { length: 80 }).notNull(),
    /** Groep: personeel, editors, freelancers, marketing, vast, operationeel,
     *  controle, prive of belasting. Bepaalt of het als bedrijfskosten telt. */
    groep: varchar("groep", { length: 24 }).notNull(),
    /** Soort: vast, variabel, eenmalig, controle of geen. */
    soort: varchar("soort", { length: 16 }).notNull(),
    /** Wat er echt van de rekening ging (inclusief btw). */
    metBtw: numeric("met_btw", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Bedrag exclusief btw (per leverancier bepaald tarief). */
    zonderBtw: numeric("zonder_btw", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Aantal afschrijvingen dat in deze regel is samengevat. */
    aantal: integer("aantal").notNull().default(1),
    /** Datum van de maandelijkse uitlezing uit DigiBoox. */
    bijgewerkt: date("bijgewerkt"),
    ...timestamps,
  },
  (t) => [index("kosten_regels_maand_idx").on(t.maand)],
);

/** Gefactureerde omzet (zonder btw) per maand — nodig voor "Onder de streep". */
export const kostenOmzet = pgTable(
  "kosten_omzet",
  {
    id: pk(),
    /** Maand als YYYY-MM. */
    maand: varchar("maand", { length: 7 }).notNull(),
    omzet: numeric("omzet", { precision: 12, scale: 2 }).notNull().default("0"),
    bijgewerkt: date("bijgewerkt"),
    ...timestamps,
  },
  (t) => [unique("kosten_omzet_maand_unique").on(t.maand)],
);
