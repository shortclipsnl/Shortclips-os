import { relations, sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { captionItemStatusEnum, captionSetStatusEnum } from "./enums";
import { clients } from "./clients";
import { productionDays } from "./production";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Automatische captions per opname
 *
 * Eén `captionSets`-rij per opnamesessie (productionDay). Zodra de
 * scriptcontrole-PDF van die opname beschikbaar/gewijzigd is, maakt de
 * Caption Maker automatisch per short één caption en bewaart die als
 * `captionItems`. `sourceHash` (sha256 van de verwerkte PDF) voorkomt dat
 * ongewijzigde scripts opnieuw de AI aanroepen; handmatig bewerkte captions
 * (`isEdited`) worden bij een nieuwe versie bewaard en gemarkeerd als
 * "nieuwere versie beschikbaar" (`staleFromNewVersion`).
 * ------------------------------------------------------------------ */

export const captionSets = pgTable(
  "caption_sets",
  {
    id: pk(),
    /** De opnamesessie waar deze captions bij horen (één set per opname). */
    productionDayId: uuid("production_day_id")
      .notNull()
      .references(() => productionDays.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: captionSetStatusEnum("status").notNull().default("bezig"),
    /** De scriptcontrole-PDF-versie die verwerkt is (script_review_versions.id). */
    sourceReviewVersionId: uuid("source_review_version_id"),
    /** sha256 van de verwerkte PDF-bytes — wijzigingsdetectie (geen AI-kosten
     *  als de hash gelijk blijft). */
    sourceHash: varchar("source_hash", { length: 64 }),
    /** Wanneer de captions voor het laatst (succesvol) gegenereerd zijn. */
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    /** Start van de huidige generatie — guard tegen dubbel draaien. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Laatste foutmelding (bij status 'mislukt'/'gedeeltelijk'). */
    errorMessage: text("error_message"),
    /** Gecontroleerd/akkoord door een teamlid. */
    checkedById: uuid("checked_by_id").references(() => users.id, { onDelete: "set null" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("caption_sets_production_day_unique").on(t.productionDayId),
    index("caption_sets_client_idx").on(t.clientId, t.status),
  ],
);

export const captionItems = pgTable(
  "caption_items",
  {
    id: pk(),
    captionSetId: uuid("caption_set_id")
      .notNull()
      .references(() => captionSets.id, { onDelete: "cascade" }),
    /** Volgorde binnen de set (0-based), gelijk aan de volgorde in de PDF. */
    position: integer("position").notNull().default(0),
    shortTitle: varchar("short_title", { length: 300 }).notNull().default(""),
    hook: text("hook").notNull().default(""),
    /** De caption zelf — bewerkbaar door het team. */
    caption: text("caption").notNull().default(""),
    /** Eventueel toepasbare hashtags: string[]. */
    hashtags: jsonb("hashtags").notNull().default(sql`'[]'::jsonb`),
    status: captionItemStatusEnum("status").notNull().default("gegenereerd"),
    /** Handmatig aangepast — niet overschrijven bij hergenereren. */
    isEdited: boolean("is_edited").notNull().default(false),
    /** Script is sindsdien in een nieuwere versie veranderd (handmatig bewerkte
     *  caption bleef staan, maar het team kan 'm opnieuw laten genereren). */
    staleFromNewVersion: boolean("stale_from_new_version").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("caption_items_set_idx").on(t.captionSetId, t.position)],
);

/* ------------------------------------------------------------------ *
 * Automatische koppeling opname → script-PDF in Google Drive
 *
 * Veel opnames hebben (nog) geen scriptcontrole-PDF in het portaal, terwijl de
 * script-PDF wél in Google Drive klaarstaat (gesynct in `files`, categorie
 * "Scripts"). Deze tabel legt per opname een INTERNE koppeling naar die
 * Drive-PDF vast, zodat de Caption Maker 'm als bron kan gebruiken — zónder er
 * een klant-zichtbare scriptReview van te maken.
 *
 * `status`: "gekoppeld" (zeker — wordt als bron gebruikt), "suggestie" (niet
 * zeker — wacht op bevestiging door het team) of "afgewezen". `confidence` legt
 * vast hoe sterk de match was; `matchReason` is de leesbare uitleg voor het team.
 * ------------------------------------------------------------------ */
export const shootScriptSources = pgTable(
  "shoot_script_sources",
  {
    id: pk(),
    /** Eén koppeling per opname. */
    productionDayId: uuid("production_day_id")
      .notNull()
      .references(() => productionDays.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** "gekoppeld" | "suggestie" | "afgewezen". */
    status: varchar("status", { length: 16 }).notNull().default("suggestie"),
    /** "hoog" | "middel" | "laag". */
    confidence: varchar("confidence", { length: 8 }).notNull().default("laag"),
    /** Het Drive-bestand (files.external_id) en de leesbare metadata. */
    fileExternalId: varchar("file_external_id", { length: 240 }).notNull(),
    fileName: varchar("file_name", { length: 400 }).notNull(),
    filePath: text("file_path"),
    /** Leesbare uitleg waarom dit bestand gekoppeld is (bijv. "datum 12-11 in naam"). */
    matchReason: text("match_reason"),
    /** sha256 van de laatst verwerkte PDF-bytes — detecteert een gewijzigde PDF. */
    contentHash: varchar("content_hash", { length: 64 }),
    matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
    /** Door wie/wanneer een suggestie is bevestigd. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedById: uuid("confirmed_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("shoot_script_sources_day_unique").on(t.productionDayId),
    index("shoot_script_sources_client_idx").on(t.clientId, t.status),
  ],
);

export const shootScriptSourcesRelations = relations(shootScriptSources, ({ one }) => ({
  productionDay: one(productionDays, { fields: [shootScriptSources.productionDayId], references: [productionDays.id] }),
  client: one(clients, { fields: [shootScriptSources.clientId], references: [clients.id] }),
}));

export const captionSetsRelations = relations(captionSets, ({ one, many }) => ({
  productionDay: one(productionDays, { fields: [captionSets.productionDayId], references: [productionDays.id] }),
  client: one(clients, { fields: [captionSets.clientId], references: [clients.id] }),
  checkedBy: one(users, { fields: [captionSets.checkedById], references: [users.id] }),
  items: many(captionItems),
}));

export const captionItemsRelations = relations(captionItems, ({ one }) => ({
  set: one(captionSets, { fields: [captionItems.captionSetId], references: [captionSets.id] }),
}));
