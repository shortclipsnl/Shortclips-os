import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { quoteStatusEnum } from "./enums";
import { clients } from "./clients";
import { salesLeads } from "./finance";
import { users } from "./identity";

/**
 * Offertes-module (PandaDoc-vervanger). Een sjabloon levert de opmaak + vaste
 * teksten; een offerte snapshot bij aanmaak zijn eigen inhoud (`content`) zodat
 * het later bewerken van een sjabloon nooit al verzonden offertes verandert.
 * De publieke link is onvoorspelbaar: we bewaren alleen de SHA-256-hash
 * (`tokenHash`), nooit het ruwe token. Alleen de eigenaar beheert dit intern.
 */

/** Herbruikbaar offertesjabloon (bijv. "Maandelijkse samenwerking"). */
export const quoteTemplates = pgTable(
  "quote_templates",
  {
    id: pk(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    /** actief = kiesbaar bij een nieuwe offerte; gearchiveerd = verborgen. */
    isArchived: boolean("is_archived").notNull().default(false),
    /** Verwijzing naar de huidige (nieuwste) versie, voor snel laden. */
    currentVersion: integer("current_version").notNull().default(1),
    source: varchar("source", { length: 20 }).notNull().default("manual"), // manual | pandadoc
    externalId: varchar("external_id", { length: 200 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("quote_templates_archived_idx").on(t.isArchived),
    unique("quote_templates_external_unique").on(t.externalId),
  ],
);

/**
 * Onveranderlijke versie van een sjabloon. Bij elke bewerking komt er een
 * nieuwe versie bij; eerdere offertes blijven naar hun eigen versie wijzen.
 * `content` = gestructureerd inhoudsmodel (secties: tekst/afbeelding/regeltabel/
 * voorwaarden) + branding, zodat scherm en PDF identiek renderen.
 */
export const quoteTemplateVersions = pgTable(
  "quote_template_versions",
  {
    id: pk(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => quoteTemplates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [unique("quote_template_versions_unique").on(t.templateId, t.version)],
);

/** Eén offerte. Hangt aan een lead (pre-sale) en/of een klant. */
export const quotes = pgTable(
  "quotes",
  {
    id: pk(),
    /** Doorlopend offertenummer, bijv. "2026-014". */
    number: varchar("number", { length: 40 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    status: quoteStatusEnum("status").notNull().default("concept"),

    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => salesLeads.id, { onDelete: "set null" }),
    templateVersionId: uuid("template_version_id").references(() => quoteTemplateVersions.id, { onDelete: "set null" }),

    /** Ontvanger — gesnapshot zodat latere klantwijzigingen de offerte niet raken. */
    recipientCompany: varchar("recipient_company", { length: 200 }),
    recipientContactName: varchar("recipient_contact_name", { length: 160 }),
    recipientEmail: varchar("recipient_email", { length: 320 }),

    /** Volledige offerte-inhoud op het moment van aanmaken (bron voor scherm + PDF). */
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    /** SHA-256 van de definitieve inhoud; bewijst dat een geaccepteerde offerte ongewijzigd is. */
    contentHash: varchar("content_hash", { length: 64 }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    notes: text("notes"),

    /** Onvoorspelbaar publiek token (32 random bytes, base64url) voor de deel-link.
     *  Owner-only opgeslagen; de klant bereikt de offerte er zonder login mee. */
    publicToken: varchar("public_token", { length: 64 }),

    /** Open-tracking (eigen previews tellen niet mee). */
    firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    expiresOn: timestamp("expires_on", { withTimezone: true }),

    /** Digitale acceptatie + bewijsrecord. */
    acceptedByName: varchar("accepted_by_name", { length: 160 }),
    acceptanceEvidence: jsonb("acceptance_evidence"),

    /** Gekwalificeerde e-handtekening (Signhost/Evidos). */
    signhostTransactionId: varchar("signhost_transaction_id", { length: 80 }),
    signedPdfPath: text("signed_pdf_path"),
    signingReceiptPath: text("signing_receipt_path"),

    /** Herkomst + migratie. */
    source: varchar("source", { length: 20 }).notNull().default("manual"), // manual | pandadoc
    externalId: varchar("external_id", { length: 200 }),
    isReadOnly: boolean("is_read_only").notNull().default(false),
    originalPdfPath: text("original_pdf_path"),

    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("quotes_number_unique").on(t.number),
    unique("quotes_token_unique").on(t.publicToken),
    unique("quotes_external_unique").on(t.externalId),
    index("quotes_status_idx").on(t.status),
    index("quotes_client_idx").on(t.clientId),
    index("quotes_lead_idx").on(t.leadId),
  ],
);

/** Regels (diensten/prijzen) van een offerte. */
export const quoteLines = pgTable(
  "quote_lines",
  {
    id: pk(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    description: varchar("description", { length: 240 }).notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull().default("0"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("quote_lines_quote_idx").on(t.quoteId)],
);

/**
 * Gebeurtenissenlog per offerte: aangemaakt, verzonden, geopend, geaccepteerd,
 * afgewezen, ondertekenen gestart, ondertekend. Levert de tracking-tijdlijn en
 * het open-bewijs (IP/user-agent). Aanvullend op de centrale auditlog.
 */
export const quoteEvents = pgTable(
  "quote_events",
  {
    id: pk(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 30 }).notNull(),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    meta: jsonb("meta"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("quote_events_quote_idx").on(t.quoteId, t.occurredAt)],
);

export const quoteTemplatesRelations = relations(quoteTemplates, ({ many }) => ({
  versions: many(quoteTemplateVersions),
}));

export const quoteTemplateVersionsRelations = relations(quoteTemplateVersions, ({ one }) => ({
  template: one(quoteTemplates, { fields: [quoteTemplateVersions.templateId], references: [quoteTemplates.id] }),
}));

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  client: one(clients, { fields: [quotes.clientId], references: [clients.id] }),
  lead: one(salesLeads, { fields: [quotes.leadId], references: [salesLeads.id] }),
  templateVersion: one(quoteTemplateVersions, { fields: [quotes.templateVersionId], references: [quoteTemplateVersions.id] }),
  lines: many(quoteLines),
  events: many(quoteEvents),
}));

export const quoteLinesRelations = relations(quoteLines, ({ one }) => ({
  quote: one(quotes, { fields: [quoteLines.quoteId], references: [quotes.id] }),
}));

export const quoteEventsRelations = relations(quoteEvents, ({ one }) => ({
  quote: one(quotes, { fields: [quoteEvents.quoteId], references: [quotes.id] }),
}));
