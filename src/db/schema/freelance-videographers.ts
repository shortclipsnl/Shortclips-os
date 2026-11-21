import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { users } from "./identity";

/**
 * Freelance videografen: wie we kunnen inzetten voor opnames bij klanten, met
 * contact, werkregio, specialisaties, tarief en beschikbaarheid.
 *
 * Alleen voor de eigenaar en het vaste kantoorteam. Freelancers zelf, editors
 * en klanten kunnen deze tabel nooit lezen (afgedwongen in de server-laag, zie
 * `canUseFreelanceVideographers`): er staan telefoonnummers, tarieven en interne
 * opmerkingen van andere freelancers in.
 *
 * Uitbreidbaar zonder migratie: extra links in `links`, extra velden in `extra`.
 */
export const videographerContacts = pgTable(
  "videographer_contacts",
  {
    id: pk(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    /** Verkleinde profielfoto als data-URL (jpeg/png/webp), alleen als geüpload. */
    photo: text("photo"),
    /** Woonplaats. */
    city: varchar("city", { length: 120 }),
    /** Werkregio's (vaste keuzes + eigen labels). */
    regions: jsonb("regions").notNull().default(sql`'[]'::jsonb`),
    phone: varchar("phone", { length: 40 }),
    /** WhatsApp-nummer als dat afwijkt van `phone`; leeg = zelfde nummer. */
    whatsapp: varchar("whatsapp", { length: 40 }),
    email: varchar("email", { length: 320 }),
    portfolioUrl: text("portfolio_url"),
    /** Extra portfolio- en voorbeeldlinks: [{ label, url }]. */
    links: jsonb("links").notNull().default(sql`'[]'::jsonb`),
    specialisations: jsonb("specialisations").notNull().default(sql`'[]'::jsonb`),
    /** geselecteerd | beschikbaar | in_gesprek | niet_actief */
    status: varchar("status", { length: 16 }).notNull().default("in_gesprek"),
    /** beschikbaar | beperkt | niet_beschikbaar | onbekend. Nooit automatisch. */
    availability: varchar("availability", { length: 20 }).notNull().default("onbekend"),
    availabilityNote: varchar("availability_note", { length: 300 }),
    availabilityConfirmedAt: date("availability_confirmed_at"),
    availabilityConfirmedById: uuid("availability_confirmed_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Dagprijs en uurtarief in hele euro's (ex btw), alleen als bekend. */
    dayRate: integer("day_rate"),
    hourlyRate: integer("hourly_rate"),
    rateNote: varchar("rate_note", { length: 200 }),
    /** Interne opmerkingen van het team: [{ id, at, byId, byName, text }]. */
    notes: jsonb("notes").notNull().default(sql`'[]'::jsonb`),
    /** Wat we over deze freelancer weten uit eerder werk (klanten, periode, ervaring). */
    collaborationNote: text("collaboration_note"),
    /** handmatig | portaal (bestaand videograafaccount) | bekend (door het team genoemd) */
    source: varchar("source", { length: 24 }).notNull().default("handmatig"),
    sourceLabel: varchar("source_label", { length: 200 }),
    /** Koppeling met een bestaand videograafaccount in het portaal. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    extra: jsonb("extra").notNull().default(sql`'{}'::jsonb`),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull().default(sql`now()`),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("videographer_contacts_status_idx").on(t.status),
    // Eén profiel per portaalaccount: de automatische koppeling kan nooit dubbele profielen maken.
    uniqueIndex("videographer_contacts_user_idx").on(t.userId).where(sql`${t.userId} is not null`),
  ],
);

export type VideographerContact = typeof videographerContacts.$inferSelect;
