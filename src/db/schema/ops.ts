import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import {
  aiInsightKindEnum,
  importRunStatusEnum,
  jobStatusEnum,
  matchDecisionEnum,
  notificationChannelEnum,
  notificationLevelEnum,
} from "./enums";
import { clients } from "./clients";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Activiteit — de universele tijdlijn per klant
 * ------------------------------------------------------------------ */

export const activityEvents = pgTable(
  "activity_events",
  {
    id: pk(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    /** Bijv. `script.updated`, `video.approved`, `publication.published`. */
    type: varchar("type", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }),
    entityId: uuid("entity_id"),
    title: varchar("title", { length: 300 }).notNull(),
    body: text("body"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: varchar("actor_name", { length: 160 }),
    /** Zichtbaar in het klantportaal? Interne stappen blijven intern. */
    isClientVisible: boolean("is_client_visible").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    ...timestamps,
  },
  (t) => [
    index("activity_events_client_idx").on(t.clientId, t.occurredAt),
    index("activity_events_entity_idx").on(t.entityType, t.entityId),
    index("activity_events_type_idx").on(t.type),
  ],
);

/* ------------------------------------------------------------------ *
 * Notificaties
 * ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    type: varchar("type", { length: 80 }).notNull(),
    level: notificationLevelEnum("level").notNull().default("info"),
    title: varchar("title", { length: 240 }).notNull(),
    body: text("body"),
    /** Waar de gebruiker naartoe moet om te handelen. */
    href: text("href"),
    entityType: varchar("entity_type", { length: 40 }),
    entityId: uuid("entity_id"),
    /**
     * Sleutel om dubbele meldingen te voorkomen, bijv.
     * `video_overdue:<id>:2026-08-18`.
     */
    dedupeKey: varchar("dedupe_key", { length: 200 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.readAt),
    unique("notifications_dedupe_unique").on(t.userId, t.dedupeKey),
  ],
);

/** Per gebruiker: welke soort melding via welk kanaal. */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 80 }).notNull(),
    channel: notificationChannelEnum("channel").notNull().default("in_app"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [unique("notification_prefs_unique").on(t.userId, t.type, t.channel)],
);

/* ------------------------------------------------------------------ *
 * Automatiseringen
 * ------------------------------------------------------------------ */

export const automationRules = pgTable(
  "automation_rules",
  {
    id: pk(),
    key: varchar("key", { length: 80 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    /** Gebeurtenis die de regel start, bijv. `video.status_changed`. */
    trigger: varchar("trigger", { length: 80 }).notNull(),
    /** Voorwaarden, bijv. { "to": "client_review" }. */
    conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
    /** Acties, bijv. [{ "type": "notify_client", ... }]. */
    actions: jsonb("actions").notNull().default(sql`'[]'::jsonb`),
    isEnabled: boolean("is_enabled").notNull().default(true),
    /** Alleen voor deze klant; leeg = alle klanten. */
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    runCount: integer("run_count").notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("automation_rules_key_unique").on(t.key),
    index("automation_rules_trigger_idx").on(t.trigger, t.isEnabled),
  ],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: pk(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    status: jobStatusEnum("status").notNull().default("queued"),
    triggerEvent: varchar("trigger_event", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }),
    entityId: uuid("entity_id"),
    context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
    result: jsonb("result").notNull().default(sql`'{}'::jsonb`),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("automation_runs_rule_idx").on(t.ruleId, t.createdAt),
    index("automation_runs_entity_idx").on(t.entityType, t.entityId),
  ],
);

/* ------------------------------------------------------------------ *
 * Audit logging
 * ------------------------------------------------------------------ */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorEmail: varchar("actor_email", { length: 320 }),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }),
    entityId: uuid("entity_id"),
    clientId: uuid("client_id"),
    /** Alleen de gewijzigde velden, nooit wachtwoorden of tokens. */
    changes: jsonb("changes").notNull().default(sql`'{}'::jsonb`),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    /** `allow` of `deny` — geweigerde pogingen zijn juist interessant. */
    outcome: varchar("outcome", { length: 16 }).notNull().default("allow"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    ...timestamps,
  },
  (t) => [
    index("audit_logs_actor_idx").on(t.actorUserId, t.occurredAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_action_idx").on(t.action, t.occurredAt),
  ],
);

/** Technische fouten, gescheiden van audit. Voedt de system health-pagina. */
export const errorLogs = pgTable(
  "error_logs",
  {
    id: pk(),
    /** application | integration | auth | sync | user | job */
    category: varchar("category", { length: 32 }).notNull(),
    source: varchar("source", { length: 120 }),
    message: text("message").notNull(),
    stack: text("stack"),
    context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
    userId: uuid("user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    ...timestamps,
  },
  (t) => [index("error_logs_category_idx").on(t.category, t.occurredAt)],
);

/* ------------------------------------------------------------------ *
 * AI-inzichten — altijd met bronvermelding
 * ------------------------------------------------------------------ */

export const aiInsights = pgTable(
  "ai_insights",
  {
    id: pk(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    kind: aiInsightKindEnum("kind").notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    body: text("body").notNull(),
    /**
     * Verplicht: waar dit inzicht op gebaseerd is. Zonder bronnen wordt het
     * inzicht niet getoond — geen verzonnen conclusies.
     */
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    /** Aantal datapunten achter de conclusie. */
    sampleSize: integer("sample_size").notNull().default(0),
    /** `deterministic` (berekend) of `model` (taalmodel). */
    method: varchar("method", { length: 24 }).notNull().default("deterministic"),
    model: varchar("model", { length: 80 }),
    period: varchar("period", { length: 10 }),
    /** Zichtbaar in het klantportaal? Standaard nee. */
    isClientVisible: boolean("is_client_visible").notNull().default(false),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("ai_insights_client_idx").on(t.clientId, t.kind),
    index("ai_insights_generated_idx").on(t.generatedAt),
  ],
);

/* ------------------------------------------------------------------ *
 * SOP's / interne kennis
 * ------------------------------------------------------------------ */

export const sopDocuments = pgTable(
  "sop_documents",
  {
    id: pk(),
    title: varchar("title", { length: 240 }).notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    category: varchar("category", { length: 80 }),
    body: text("body"),
    /** Bron kan een Drive-document zijn in plaats van eigen tekst. */
    fileId: uuid("file_id"),
    externalUrl: text("external_url"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    /** Rollen die dit document zien; leeg = iedereen intern. */
    visibleToRoles: jsonb("visible_to_roles").notNull().default(sql`'[]'::jsonb`),
    version: integer("version").notNull().default(1),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [unique("sop_documents_slug_unique").on(t.slug)],
);

/* ------------------------------------------------------------------ *
 * Import wizard: dry run → beoordeling → definitieve import
 * ------------------------------------------------------------------ */

export const importRuns = pgTable(
  "import_runs",
  {
    id: pk(),
    provider: varchar("provider", { length: 32 }).notNull(),
    status: importRunStatusEnum("status").notNull().default("dry_run"),
    /** Samenvatting: aantallen gevonden objecten, duplicaten, conflicten. */
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    startedById: uuid("started_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    error: text("error"),
    ...timestamps,
  },
  (t) => [index("import_runs_provider_idx").on(t.provider, t.createdAt)],
);

export const importCandidates = pgTable(
  "import_candidates",
  {
    id: pk(),
    runId: uuid("run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    externalId: varchar("external_id", { length: 240 }).notNull(),
    externalName: varchar("external_name", { length: 400 }).notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    /** Voorgestelde match met een bestaande ShortClips-entiteit. */
    suggestedEntityId: uuid("suggested_entity_id"),
    suggestedName: varchar("suggested_name", { length: 400 }),
    /** 0..1 — hoe zeker de naamvergelijking is. */
    matchScore: integer("match_score").notNull().default(0),
    decision: matchDecisionEnum("decision").notNull().default("pending"),
    decidedEntityId: uuid("decided_entity_id"),
    conflictReason: text("conflict_reason"),
    ...timestamps,
  },
  (t) => [
    index("import_candidates_run_idx").on(t.runId, t.entityType),
    unique("import_candidates_unique").on(t.runId, t.provider, t.externalId),
  ],
);

/* ------------------------------------------------------------------ *
 * Instellingen (key/value, per omgeving)
 * ------------------------------------------------------------------ */

export const appSettings = pgTable(
  "app_settings",
  {
    id: pk(),
    key: varchar("key", { length: 120 }).notNull(),
    value: jsonb("value").notNull().default(sql`'{}'::jsonb`),
    category: varchar("category", { length: 48 }).notNull().default("general"),
    description: text("description"),
    updatedById: uuid("updated_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [unique("app_settings_key_unique").on(t.key)],
);

/** Configureerbare labels/kleuren/volgorde per workflowstatus. */
export const workflowStatuses = pgTable(
  "workflow_statuses",
  {
    id: pk(),
    /** `video` | `script` | `production` | `publication` */
    domain: varchar("domain", { length: 24 }).notNull(),
    key: varchar("key", { length: 48 }).notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    color: varchar("color", { length: 9 }),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Toont deze status in het klantportaal? */
    isClientVisible: boolean("is_client_visible").notNull().default(false),
    /** Verwachte maximale doorlooptijd; overschrijding = signalering. */
    slaHours: integer("sla_hours"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [unique("workflow_statuses_unique").on(t.domain, t.key)],
);

/* ------------------------------------------------------------------ *
 * Relaties
 * ------------------------------------------------------------------ */

export const activityEventsRelations = relations(activityEvents, ({ one }) => ({
  client: one(clients, {
    fields: [activityEvents.clientId],
    references: [clients.id],
  }),
  actor: one(users, {
    fields: [activityEvents.actorUserId],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  client: one(clients, {
    fields: [notifications.clientId],
    references: [clients.id],
  }),
}));

export const automationRulesRelations = relations(
  automationRules,
  ({ many }) => ({ runs: many(automationRuns) }),
);

export const automationRunsRelations = relations(automationRuns, ({ one }) => ({
  rule: one(automationRules, {
    fields: [automationRuns.ruleId],
    references: [automationRules.id],
  }),
}));

export const aiInsightsRelations = relations(aiInsights, ({ one }) => ({
  client: one(clients, { fields: [aiInsights.clientId], references: [clients.id] }),
}));

export const importCandidatesRelations = relations(
  importCandidates,
  ({ one }) => ({
    run: one(importRuns, {
      fields: [importCandidates.runId],
      references: [importRuns.id],
    }),
  }),
);
