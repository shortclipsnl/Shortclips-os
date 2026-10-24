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
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { platformEnum, publicationStatusEnum } from "./enums";
import { clients, socialAccounts } from "./clients";
import { users } from "./identity";
import { deliverables } from "./video";

/* ------------------------------------------------------------------ *
 * Contentplanning
 * ------------------------------------------------------------------ */

export const contentCalendar = pgTable(
  "content_calendar",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, {
      onDelete: "set null",
    }),
    /** Optioneel gekoppelde opnamedag, zodat een caption bij de juiste opname hoort. */
    productionDayId: uuid("production_day_id"),
    title: varchar("title", { length: 240 }).notNull(),
    scheduledOn: date("scheduled_on").notNull(),
    scheduledAt: time("scheduled_at"),
    status: publicationStatusEnum("status").notNull().default("to_prepare"),
    /** Doelplatforms; per platform ontstaat één rij in `publications`. */
    platforms: jsonb("platforms").notNull().default(sql`'[]'::jsonb`),
    caption: text("caption"),
    hashtags: text("hashtags"),
    coverUrl: text("cover_url"),
    locationTag: varchar("location_tag", { length: 160 }),
    contentType: varchar("content_type", { length: 80 }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("content_calendar_client_idx").on(t.clientId, t.scheduledOn),
    index("content_calendar_date_idx").on(t.scheduledOn, t.status),
  ],
);

export const publications = pgTable(
  "publications",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    calendarItemId: uuid("calendar_item_id").references(() => contentCalendar.id, {
      onDelete: "set null",
    }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, {
      onDelete: "set null",
    }),
    socialAccountId: uuid("social_account_id").references(() => socialAccounts.id, {
      onDelete: "set null",
    }),
    platform: platformEnum("platform").notNull(),
    status: publicationStatusEnum("status").notNull().default("scheduled"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    externalPostId: varchar("external_post_id", { length: 200 }),
    externalUrl: text("external_url"),
    caption: text("caption"),
    failureReason: text("failure_reason"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("publications_client_idx").on(t.clientId, t.publishedAt),
    index("publications_platform_idx").on(t.platform, t.status),
    unique("publications_external_unique").on(t.platform, t.externalPostId),
  ],
);

/* ------------------------------------------------------------------ *
 * Statistieken — dagelijkse snapshots zijn de ruggengraat.
 * Platforms bewaren zelf weinig historie, dus wij bewaren die.
 * ------------------------------------------------------------------ */

export const socialMetrics = pgTable(
  "social_metrics",
  {
    id: pk(),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    /** Meetdag: één rij per publicatie per dag. */
    measuredOn: date("measured_on").notNull(),
    views: integer("views").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    /** Totale kijktijd in seconden. */
    watchTimeSeconds: integer("watch_time_seconds").notNull().default(0),
    avgWatchSeconds: numeric("avg_watch_seconds", { precision: 8, scale: 2 }),
    completionRate: numeric("completion_rate", { precision: 5, scale: 4 }),
    retentionCurve: jsonb("retention_curve"),
    profileVisits: integer("profile_visits").notNull().default(0),
    followerDelta: integer("follower_delta").notNull().default(0),
    linkClicks: integer("link_clicks"),
    conversions: integer("conversions"),
    /** Herkomst van de cijfers: ayrshare, metricool, manual, ... */
    source: varchar("source", { length: 32 }).notNull().default("manual"),
    ...timestamps,
  },
  (t) => [
    unique("social_metrics_unique").on(t.publicationId, t.measuredOn),
    index("social_metrics_client_idx").on(t.clientId, t.measuredOn),
  ],
);

/** Dagelijkse totalen per klant/platform — snelle trendgrafieken. */
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    platform: platformEnum("platform"),
    measuredOn: date("measured_on").notNull(),
    views: integer("views").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    engagements: integer("engagements").notNull().default(0),
    followers: integer("followers").notNull().default(0),
    followerDelta: integer("follower_delta").notNull().default(0),
    postsPublished: integer("posts_published").notNull().default(0),
    /** Likes en reacties (reels), per klant/platform/dag uit Metricool. */
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    /** Waardevolle interacties: shares + saves (reels). */
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    /** Totale kijktijd (seconden) en reels-weergaven → gem. kijkduur. */
    watchSeconds: integer("watch_seconds").notNull().default(0),
    videoViews: integer("video_views").notNull().default(0),
    source: varchar("source", { length: 32 }).notNull().default("aggregate"),
    ...timestamps,
  },
  (t) => [
    unique("daily_metrics_unique").on(t.clientId, t.platform, t.measuredOn),
    index("daily_metrics_client_idx").on(t.clientId, t.measuredOn),
  ],
);

export const clientReports = pgTable(
  "client_reports",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** `month` of `quarter`. */
    periodType: varchar("period_type", { length: 16 }).notNull().default("month"),
    /** YYYY-MM of YYYY-Qn. */
    period: varchar("period", { length: 10 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    summary: text("summary"),
    /** Automatisch berekende cijfers. */
    metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
    /** Handmatige toelichting van de projectcoördinator. */
    manualNote: text("manual_note"),
    isPublished: boolean("is_published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    generatedById: uuid("generated_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("client_reports_unique").on(t.clientId, t.periodType, t.period),
    index("client_reports_client_idx").on(t.clientId),
  ],
);

/* ------------------------------------------------------------------ *
 * Relaties
 * ------------------------------------------------------------------ */

export const contentCalendarRelations = relations(
  contentCalendar,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [contentCalendar.clientId],
      references: [clients.id],
    }),
    deliverable: one(deliverables, {
      fields: [contentCalendar.deliverableId],
      references: [deliverables.id],
    }),
    publications: many(publications),
  }),
);

export const publicationsRelations = relations(publications, ({ one, many }) => ({
  client: one(clients, {
    fields: [publications.clientId],
    references: [clients.id],
  }),
  calendarItem: one(contentCalendar, {
    fields: [publications.calendarItemId],
    references: [contentCalendar.id],
  }),
  deliverable: one(deliverables, {
    fields: [publications.deliverableId],
    references: [deliverables.id],
  }),
  metrics: many(socialMetrics),
}));

export const socialMetricsRelations = relations(socialMetrics, ({ one }) => ({
  publication: one(publications, {
    fields: [socialMetrics.publicationId],
    references: [publications.id],
  }),
}));

export const clientReportsRelations = relations(clientReports, ({ one }) => ({
  client: one(clients, {
    fields: [clientReports.clientId],
    references: [clients.id],
  }),
}));
