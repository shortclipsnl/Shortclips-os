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
import {
  eventProcessingStatusEnum,
  fileSourceEnum,
  integrationProviderEnum,
  integrationStatusEnum,
  jobStatusEnum,
  syncDirectionEnum,
} from "./enums";
import { clients } from "./clients";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Bestanden — metadata lokaal, inhoud blijft bij de bron (Drive/Frame)
 * ------------------------------------------------------------------ */

export const files = pgTable(
  "files",
  {
    id: pk(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 400 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }),
    sizeBytes: numeric("size_bytes", { precision: 20, scale: 0 }),
    source: fileSourceEnum("source").notNull().default("google_drive"),
    externalId: varchar("external_id", { length: 240 }),
    externalUrl: text("external_url"),
    /** Logische map: Strategie, Scripts, Opnames, Video, Rapportages, ... */
    category: varchar("category", { length: 64 }),
    /** Pad binnen de klantmap, voor herkenbaarheid in zoekresultaten. */
    path: text("path"),
    parentExternalId: varchar("parent_external_id", { length: 240 }),
    isFolder: boolean("is_folder").notNull().default(false),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("files_client_idx").on(t.clientId, t.category),
    index("files_external_idx").on(t.source, t.externalId),
    index("files_parent_idx").on(t.parentExternalId),
  ],
);

/* ------------------------------------------------------------------ *
 * Mapping-tabellen: één ShortClips-entiteit ↔ één extern object.
 * Bewust per provider, zodat elke koppeling eigen velden mag hebben.
 * ------------------------------------------------------------------ */

export const mondayMappings = pgTable(
  "monday_mappings",
  {
    id: pk(),
    /** Welke ShortClips-entiteit: `client`, `deliverable`, `task`, ... */
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: uuid("entity_id"),
    boardId: varchar("board_id", { length: 60 }).notNull(),
    groupId: varchar("group_id", { length: 60 }),
    itemId: varchar("item_id", { length: 60 }),
    /** Kolom-mapping: { "status": "status_1", "deadline": "date4" }. */
    columnMap: jsonb("column_map").notNull().default(sql`'{}'::jsonb`),
    direction: syncDirectionEnum("direction").notNull().default("inbound"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** Hash van de laatst gesynchroniseerde payload — voorkomt sync-loops. */
    lastPayloadHash: varchar("last_payload_hash", { length: 64 }),
    ...timestamps,
  },
  (t) => [
    unique("monday_mappings_item_unique").on(t.entityType, t.itemId),
    index("monday_mappings_entity_idx").on(t.entityType, t.entityId),
    index("monday_mappings_board_idx").on(t.boardId),
  ],
);

export const frameMappings = pgTable(
  "frame_mappings",
  {
    id: pk(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: uuid("entity_id"),
    accountId: varchar("account_id", { length: 120 }),
    workspaceId: varchar("workspace_id", { length: 120 }),
    projectId: varchar("project_id", { length: 120 }),
    folderId: varchar("folder_id", { length: 120 }),
    assetId: varchar("asset_id", { length: 120 }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastPayloadHash: varchar("last_payload_hash", { length: 64 }),
    ...timestamps,
  },
  (t) => [
    unique("frame_mappings_asset_unique").on(t.entityType, t.assetId),
    index("frame_mappings_entity_idx").on(t.entityType, t.entityId),
    index("frame_mappings_project_idx").on(t.projectId),
  ],
);

export const driveMappings = pgTable(
  "drive_mappings",
  {
    id: pk(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: uuid("entity_id"),
    driveId: varchar("drive_id", { length: 120 }),
    folderId: varchar("folder_id", { length: 200 }).notNull(),
    folderName: varchar("folder_name", { length: 400 }),
    /** Logische submappen: { "Scripts": "<folderId>", ... }. */
    subfolderMap: jsonb("subfolder_map").notNull().default(sql`'{}'::jsonb`),
    /** Google Drive changes-token voor incrementele sync. */
    pageToken: text("page_token"),
    watchChannelId: varchar("watch_channel_id", { length: 120 }),
    watchExpiresAt: timestamp("watch_expires_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("drive_mappings_folder_unique").on(t.entityType, t.folderId),
    index("drive_mappings_entity_idx").on(t.entityType, t.entityId),
  ],
);

/* ------------------------------------------------------------------ *
 * Integratie-verbindingen en hun gezondheid
 * ------------------------------------------------------------------ */

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: pk(),
    provider: integrationProviderEnum("provider").notNull(),
    status: integrationStatusEnum("status").notNull().default("not_configured"),
    /** Naam van de env-variabelen die deze koppeling nodig heeft. */
    requiredEnv: jsonb("required_env").notNull().default(sql`'[]'::jsonb`),
    /** Niet-gevoelige configuratie (account-id, workspace, scopes). */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    /**
     * Let op: hier staan NOOIT tokens. Secrets komen uitsluitend uit
     * environment variables. Dit veld bevat alleen metadata over het token,
     * zoals verloopdatum en scopes, voor de health-pagina.
     */
    tokenMeta: jsonb("token_meta").notNull().default(sql`'{}'::jsonb`),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastErrorMessage: text("last_error_message"),
    itemsSynced: integer("items_synced").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [unique("integration_connections_provider_unique").on(t.provider)],
);

/* ------------------------------------------------------------------ *
 * Webhooks: eerst opslaan, daarna pas verwerken. Idempotent.
 * ------------------------------------------------------------------ */

export const integrationEvents = pgTable(
  "integration_events",
  {
    id: pk(),
    provider: integrationProviderEnum("provider").notNull(),
    /** Event-id van de leverancier; uniek per provider = geen dubbele verwerking. */
    externalEventId: varchar("external_event_id", { length: 240 }).notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    payload: jsonb("payload").notNull(),
    /** SHA-256 van de payload — vangt herhaalde bezorging zonder event-id af. */
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    signatureValid: boolean("signature_valid"),
    status: eventProcessingStatusEnum("status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    retryCount: integer("retry_count").notNull().default(0),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    unique("integration_events_external_unique").on(
      t.provider,
      t.externalEventId,
    ),
    index("integration_events_hash_idx").on(t.provider, t.payloadHash),
    index("integration_events_status_idx").on(t.status, t.receivedAt),
  ],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: pk(),
    provider: integrationProviderEnum("provider").notNull(),
    /** Bijv. `monday.import_clients`, `frameio.pull_comments`. */
    jobType: varchar("job_type", { length: 80 }).notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    direction: syncDirectionEnum("direction").notNull().default("inbound"),
    scopeType: varchar("scope_type", { length: 40 }),
    scopeId: uuid("scope_id"),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    itemsProcessed: integer("items_processed").notNull().default(0),
    itemsCreated: integer("items_created").notNull().default(0),
    itemsUpdated: integer("items_updated").notNull().default(0),
    itemsFailed: integer("items_failed").notNull().default(0),
    /** Regel-voor-regel logging, zichtbaar op de integratiepagina. */
    log: jsonb("log").notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    triggeredById: uuid("triggered_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("sync_jobs_provider_idx").on(t.provider, t.status),
    index("sync_jobs_created_idx").on(t.createdAt),
  ],
);

export const filesRelations = relations(files, ({ one }) => ({
  client: one(clients, { fields: [files.clientId], references: [clients.id] }),
}));

export const syncJobsRelations = relations(syncJobs, ({ one }) => ({
  triggeredBy: one(users, {
    fields: [syncJobs.triggeredById],
    references: [users.id],
  }),
}));
