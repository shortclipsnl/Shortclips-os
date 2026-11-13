import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, smallint, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { users } from "./identity";

/**
 * Editor database: alle actieve, back up, potentiële en niet geschikte editors
 * op één plek, zodat het team bij uitval of spoed zelf een editor vindt.
 *
 * Alleen voor de eigenaar en het vaste kantoorteam. Freelance editors,
 * videografen en klanten kunnen deze tabel nooit lezen (afgedwongen in de
 * server-laag, zie `canUseEditorDatabase`).
 *
 * Uitbreidbaar zonder migratie: extra links staan in `links` en extra velden
 * kunnen in `extra` (jsonb) totdat ze een eigen kolom verdienen.
 */
export const editorContacts = pgTable(
  "editor_contacts",
  {
    id: pk(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    /** Telefoon zoals ingevoerd. */
    phone: varchar("phone", { length: 40 }),
    /** WhatsApp-nummer als dat afwijkt van `phone`; leeg = zelfde nummer. */
    whatsapp: varchar("whatsapp", { length: 40 }),
    email: varchar("email", { length: 320 }),
    portfolioUrl: text("portfolio_url"),
    /** Extra portfolio- en voorbeeldlinks: [{ label, url }]. */
    links: jsonb("links").notNull().default(sql`'[]'::jsonb`),
    /** Specialisaties (vaste keuzes + eigen labels). */
    specialisations: jsonb("specialisations").notNull().default(sql`'[]'::jsonb`),
    /** actief | backup | potentieel | niet_geschikt */
    category: varchar("category", { length: 16 }).notNull().default("potentieel"),
    /** ja | nee | onbekend: heeft deze editor al voor Shortclips gewerkt? */
    workedWithUs: varchar("worked_with_us", { length: 12 }).notNull().default("onbekend"),
    /** Toelichting op de eerdere samenwerking (klanten, periode, ervaring). */
    collaborationNote: text("collaboration_note"),
    /** Tarief per video in hele euro's (ex btw), alleen als bekend. */
    ratePerVideo: integer("rate_per_video"),
    rateNote: varchar("rate_note", { length: 200 }),
    /** beschikbaar | beperkt | niet_beschikbaar | onbekend. Nooit automatisch. */
    availability: varchar("availability", { length: 20 }).notNull().default("onbekend"),
    availabilityNote: varchar("availability_note", { length: 300 }),
    /** Wanneer de beschikbaarheid voor het laatst met de editor is bevestigd. */
    availabilityConfirmedAt: date("availability_confirmed_at"),
    availabilityConfirmedById: uuid("availability_confirmed_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Interne beoordeling 1-5; leeg = nog niet beoordeeld. */
    ratingQuality: smallint("rating_quality"),
    ratingCollaboration: smallint("rating_collaboration"),
    favorite: boolean("favorite").notNull().default(false),
    /** Opmerkingen van het team: [{ id, at, byId, byName, text }]. */
    notes: jsonb("notes").notNull().default(sql`'[]'::jsonb`),
    /** Velden die uit een import komen en nog niet door het team zijn bevestigd. */
    unverifiedFields: jsonb("unverified_fields").notNull().default(sql`'[]'::jsonb`),
    /** handmatig | whatsapp_export | csv_import | portaal (bestaande editor) */
    source: varchar("source", { length: 24 }).notNull().default("handmatig"),
    sourceLabel: varchar("source_label", { length: 120 }),
    /** Koppeling met een bestaand editoraccount in het portaal. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Ruimte voor latere velden zonder de database opnieuw op te bouwen. */
    extra: jsonb("extra").notNull().default(sql`'{}'::jsonb`),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull().default(sql`now()`),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("editor_contacts_category_idx").on(t.category),
    index("editor_contacts_user_idx").on(t.userId),
  ],
);

export type EditorContact = typeof editorContacts.$inferSelect;
