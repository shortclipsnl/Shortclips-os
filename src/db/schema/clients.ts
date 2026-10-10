import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
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
import {
  clientStatusEnum,
  contractStatusEnum,
  integrationProviderEnum,
  platformEnum,
  riskLevelEnum,
} from "./enums";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Klant = de centrale entiteit van ShortClips OS
 * ------------------------------------------------------------------ */

export const clients = pgTable(
  "clients",
  {
    id: pk(),
    /** Menselijke sleutel, ook gebruikt in URL's: bijv. `friesland-lease`. */
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    legalName: varchar("legal_name", { length: 200 }),
    sector: varchar("sector", { length: 120 }),
    website: text("website"),
    logoUrl: text("logo_url"),
    /** Accentkleur voor kaarten/avatars in de UI. */
    color: varchar("color", { length: 9 }),
    status: clientStatusEnum("status").notNull().default("active"),
    riskLevel: riskLevelEnum("risk_level").notNull().default("none"),
    riskReason: text("risk_reason"),
    startedOn: date("started_on"),
    /** Verantwoordelijken. */
    coordinatorId: uuid("coordinator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    videographerId: uuid("videographer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Afspraken uit het contract, gedenormaliseerd voor snelle dashboards. */
    monthlyVideoQuota: integer("monthly_video_quota").notNull().default(0),
    monthlyRevenue: numeric("monthly_revenue", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    /** Financiële velden uit Monday (HOOFDBOARD). editCostPerVideo = editkosten
     *  per short; contractMonths = contractduur; endedOn = stopdatum (leeg = loopt). */
    editCostPerVideo: numeric("edit_cost_per_video", { precision: 10, scale: 2 }),
    contractMonths: integer("contract_months"),
    endedOn: date("ended_on"),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    notes: text("notes"),
    /**
     * Velden die handmatig (via Klantenbeheer) zijn gezet en dus NIET door de
     * Monday-import overschreven mogen worden. Zo blijft een handmatige wijziging
     * (bijv. status op "gestopt" of een andere coördinator) staan, terwijl Monday
     * de overige velden gewoon blijft bijwerken.
     */
    managedFields: jsonb("managed_fields")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<string[]>(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("clients_slug_unique").on(t.slug),
    index("clients_status_idx").on(t.status),
    index("clients_coordinator_idx").on(t.coordinatorId),
    index("clients_risk_idx").on(t.riskLevel),
  ],
);

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    role: varchar("role", { length: 120 }),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 40 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Ontvangt goedkeuringsverzoeken in het portaal. */
    isApprover: boolean("is_approver").notNull().default(false),
    notes: text("notes"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("client_contacts_client_idx").on(t.clientId)],
);

export const clientPackages = pgTable(
  "client_packages",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    videosPerMonth: integer("videos_per_month").notNull().default(0),
    shootDaysPerMonth: integer("shoot_days_per_month").notNull().default(0),
    monthlyPrice: numeric("monthly_price", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    includesReporting: boolean("includes_reporting").notNull().default(true),
    includesStrategy: boolean("includes_strategy").notNull().default(false),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("client_packages_client_idx").on(t.clientId, t.isActive)],
);

export const contracts = pgTable(
  "contracts",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    reference: varchar("reference", { length: 80 }),
    status: contractStatusEnum("status").notNull().default("active"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    /** Opzegtermijn in dagen; stuurt de verlengingssignalering aan. */
    noticePeriodDays: integer("notice_period_days").notNull().default(30),
    autoRenew: boolean("auto_renew").notNull().default(true),
    renewalMonths: integer("renewal_months").notNull().default(12),
    monthlyValue: numeric("monthly_value", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    documentFileId: uuid("document_file_id"),
    notes: text("notes"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("contracts_client_idx").on(t.clientId),
    index("contracts_end_idx").on(t.endsOn),
  ],
);

/* ------------------------------------------------------------------ *
 * Koppelingen naar externe systemen
 * ------------------------------------------------------------------ */

export const clientIntegrations = pgTable(
  "client_integrations",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    /** Board-, project- of map-ID bij de externe partij. */
    externalId: varchar("external_id", { length: 200 }).notNull(),
    externalName: varchar("external_name", { length: 240 }),
    externalUrl: text("external_url"),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("client_integrations_unique").on(t.clientId, t.provider, t.externalId),
    index("client_integrations_provider_idx").on(t.provider, t.externalId),
  ],
);

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    handle: varchar("handle", { length: 160 }).notNull(),
    profileUrl: text("profile_url"),
    externalAccountId: varchar("external_account_id", { length: 200 }),
    followers: integer("followers").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("social_accounts_unique").on(t.clientId, t.platform, t.handle),
    index("social_accounts_client_idx").on(t.clientId),
  ],
);

/* ------------------------------------------------------------------ *
 * Klantkennis — voedt straks de AI-laag
 * ------------------------------------------------------------------ */

export const clientKnowledge = pgTable(
  "client_knowledge",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /**
     * Categorie, bijv. `tone_of_voice`, `audience`, `products`, `avoid_words`,
     * `hook_style`, `editing_style`, `competitor`, `content_pillar`,
     * `strong_example`, `weak_example`, `recurring_correction`, `fact`.
     */
    category: varchar("category", { length: 64 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    /** Vrij label, bijv. platform of pijler. */
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    /** Handmatig ingevoerd of door AI voorgesteld. */
    source: varchar("source", { length: 32 }).notNull().default("manual"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    isPinned: boolean("is_pinned").notNull().default(false),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("client_knowledge_client_idx").on(t.clientId, t.category),
    index("client_knowledge_pinned_idx").on(t.isPinned),
  ],
);

/* ------------------------------------------------------------------ *
 * Relaties
 * ------------------------------------------------------------------ */

export const clientsRelations = relations(clients, ({ one, many }) => ({
  coordinator: one(users, {
    fields: [clients.coordinatorId],
    references: [users.id],
    relationName: "client_coordinator",
  }),
  videographer: one(users, {
    fields: [clients.videographerId],
    references: [users.id],
    relationName: "client_videographer",
  }),
  contacts: many(clientContacts),
  packages: many(clientPackages),
  contracts: many(contracts),
  integrations: many(clientIntegrations),
  socialAccounts: many(socialAccounts),
  knowledge: many(clientKnowledge),
}));

export const clientContactsRelations = relations(clientContacts, ({ one }) => ({
  client: one(clients, {
    fields: [clientContacts.clientId],
    references: [clients.id],
  }),
}));

export const clientPackagesRelations = relations(clientPackages, ({ one }) => ({
  client: one(clients, {
    fields: [clientPackages.clientId],
    references: [clients.id],
  }),
}));

export const contractsRelations = relations(contracts, ({ one }) => ({
  client: one(clients, { fields: [contracts.clientId], references: [clients.id] }),
}));

export const clientIntegrationsRelations = relations(
  clientIntegrations,
  ({ one }) => ({
    client: one(clients, {
      fields: [clientIntegrations.clientId],
      references: [clients.id],
    }),
  }),
);

export const socialAccountsRelations = relations(socialAccounts, ({ one }) => ({
  client: one(clients, {
    fields: [socialAccounts.clientId],
    references: [clients.id],
  }),
}));

export const clientKnowledgeRelations = relations(clientKnowledge, ({ one }) => ({
  client: one(clients, {
    fields: [clientKnowledge.clientId],
    references: [clients.id],
  }),
}));
