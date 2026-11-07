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
import { monthlyReportStatusEnum, platformEnum, publicationStatusEnum } from "./enums";
import { clients, socialAccounts } from "./clients";
import { users } from "./identity";
import { deliverables } from "./video";

/* ------------------------------------------------------------------ *
 * Verbeteracties voor de klant ("Wat gaan we verbeteren?")
 * ------------------------------------------------------------------ */

/**
 * Per klant per maand een verbeterplan dat op de resultatenpagina van de klant
 * verschijnt — gebaseerd op de statistieken/AI-inzichten. Wordt eerst als concept
 * opgesteld (AI of handmatig) en pas na goedkeuring door de content creative
 * zichtbaar voor de klant.
 */
export const clientImprovements = pgTable(
  "client_improvements",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    /** Periode (YYYY-MM) waar het verbeterplan bij hoort. */
    period: varchar("period", { length: 7 }).notNull(),
    /** { watWerkt[], watMinder[], volgendeWeek[], volgendeMaand[], formats[], optimalisaties[] } */
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    /** concept = intern; approved = gedeeld met de klant. */
    status: varchar("status", { length: 12 }).notNull().default("concept"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [unique("client_improvements_period_unique").on(t.clientId, t.period)],
);

/**
 * Persoonlijke maand-videoboodschap van de content creator aan de klant: een
 * korte video (link) met toelichting over de resultaten en wat we verbeteren.
 * Eén per klant per maand; getoond op de resultatenpagina van de klant.
 */
export const clientVideoUpdates = pgTable(
  "client_video_updates",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    /** Periode (YYYY-MM) waar de videoboodschap bij hoort. */
    period: varchar("period", { length: 7 }).notNull(),
    /** Link naar de video (Loom/YouTube/Vimeo/…). */
    videoUrl: text("video_url").notNull(),
    /** Korte toelichting naast de video (optioneel). */
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [unique("client_video_updates_period_unique").on(t.clientId, t.period)],
);

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
    /** Goedgekeurd en gedeeld met de klant: pas dan zichtbaar in het klantportaal.
     *  Zo blijven interne conceptplanningen onzichtbaar tot een medewerker ze
     *  expliciet goedkeurt en deelt. */
    clientApproved: boolean("client_approved").notNull().default(false),
    clientApprovedAt: timestamp("client_approved_at", { withTimezone: true }),
    clientApprovedById: uuid("client_approved_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Wanneer de klant de "je video staat online"-melding kreeg (de dag ná
     *  publicatie). Voorkomt dat dezelfde melding twee keer wordt verstuurd. */
    onlineNotifiedAt: timestamp("online_notified_at", { withTimezone: true }),
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
    /** Miniatuur-URL zoals de bron (Metricool) die levert; verloopt vaak. */
    thumbnailUrl: text("thumbnail_url"),
    /** Kleine kopie van de miniatuur als data-URI, zodat rapporten die altijd hebben. */
    thumbnailData: text("thumbnail_data"),
    /** Lengte van de video in seconden (uit Metricool). */
    durationSeconds: integer("duration_seconds"),
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

    /* ---- AI Maandrapportage (controleflow) ---- */
    /** Controle-status (spiegelt `isPublished` wanneer 'gepubliceerd'). */
    status: monthlyReportStatusEnum("status").notNull().default("gegevens_verzamelen"),
    /** De gestructureerde AI-analyse (ClientInsights). */
    analysis: jsonb("analysis").notNull().default(sql`'{}'::jsonb`),
    /** Max. 3 belangrijkste aandachtspunten deze maand. */
    aandachtspunten: jsonb("aandachtspunten").notNull().default(sql`'[]'::jsonb`),
    /** Max. 3 strategische actiepunten. */
    strategischeActies: jsonb("strategische_acties").notNull().default(sql`'[]'::jsonb`),
    /** Persoonlijke beoordeling: { positief, verbeteren, volgendeMaand, klanttekst }. */
    beoordeling: jsonb("beoordeling").notNull().default(sql`'{}'::jsonb`),
    /** Interne kwaliteitscontrole-uitslag (nooit in de klantversie). */
    kwaliteit: jsonb("kwaliteit").notNull().default(sql`'{}'::jsonb`),
    /** Gemarkeerde ontbrekende/onvolledige gegevens. */
    ontbrekendeGegevens: jsonb("ontbrekende_gegevens").notNull().default(sql`'[]'::jsonb`),
    /** Start van de huidige generatie (dubbel-draai-guard). */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Wanneer de AI-analyse klaar was. */
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("client_reports_unique").on(t.clientId, t.periodType, t.period),
    index("client_reports_client_idx").on(t.clientId),
    index("client_reports_status_idx").on(t.status),
  ],
);

/**
 * Licht strategieprofiel per klant voor AI Maandrapportages: wat de klant met de
 * content wil bereiken, zodat de analyse doelgericht is. Doelgroep en tone-of-voice
 * komen uit de bestaande profielen (clientAiProfiles / Content DNA) — niet hier.
 */
export const clientStrategyProfiles = pgTable(
  "client_strategy_profiles",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    /** Primaire doelstelling (bekendheid/bereik/volgers/sollicitanten/websitebezoek/aanvragen/verkoop/vertrouwen/werkgeverschap). */
    primaryGoal: varchar("primary_goal", { length: 40 }),
    /** Secundaire doelstellingen: string[]. */
    secondaryGoals: jsonb("secondary_goals").notNull().default(sql`'[]'::jsonb`),
    /** Eén zin die de contentstrategie samenvat. */
    strategyNote: text("strategy_note"),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [unique("client_strategy_profiles_client_unique").on(t.clientId)],
);

/**
 * Versiegeschiedenis van een goedgekeurd/gepubliceerd maandrapport. Een wijziging
 * ná goedkeuring maakt een nieuwe versie i.p.v. de definitieve versie stil te
 * overschrijven (interne traceerbaarheid).
 */
export const monthlyReportVersions = pgTable(
  "monthly_report_versions",
  {
    id: pk(),
    reportId: uuid("report_id").notNull().references(() => clientReports.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    /** Snapshot van analyse + beoordeling + strategische acties bij goedkeuring. */
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    /** `generatie` (elke (her)generatie), `goedkeuring` of `publicatie`. */
    kind: varchar("kind", { length: 16 }).notNull().default("publicatie"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("monthly_report_versions_report_idx").on(t.reportId, t.versionNumber)],
);

/**
 * Feedback van de controleur (Jarno) op een maandrapport. Blijft bewaard, ook
 * na opnieuw genereren: zo is traceerbaar wat er gevraagd is en in welke versie
 * het is verwerkt. Open feedback gaat mee in de volgende AI-generatie.
 */
export const monthlyReportFeedback = pgTable(
  "monthly_report_feedback",
  {
    id: pk(),
    reportId: uuid("report_id").notNull().references(() => clientReports.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** Versie waarop de feedback gegeven is. */
    versionNumber: integer("version_number"),
    /** Versie waarin de feedback is meegenomen (na opnieuw genereren). */
    resolvedInVersion: integer("resolved_in_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("monthly_report_feedback_report_idx").on(t.reportId, t.createdAt)],
);

/**
 * Wie een goedgekeurd maandrapport moet doornemen en of dat gebeurd is.
 * Eén rij per rapport per medewerker (idempotent).
 */
export const monthlyReportReads = pgTable(
  "monthly_report_reads",
  {
    id: pk(),
    reportId: uuid("report_id").notNull().references(() => clientReports.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Waarom deze persoon het moet lezen: coordinator, videograaf, team. */
    reason: varchar("reason", { length: 24 }).notNull().default("team"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().default(sql`now()`),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    unique("monthly_report_reads_unique").on(t.reportId, t.userId),
    index("monthly_report_reads_user_idx").on(t.userId, t.readAt),
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

export const clientReportsRelations = relations(clientReports, ({ one, many }) => ({
  client: one(clients, {
    fields: [clientReports.clientId],
    references: [clients.id],
  }),
  versions: many(monthlyReportVersions),
  feedback: many(monthlyReportFeedback),
  reads: many(monthlyReportReads),
}));

export const clientStrategyProfilesRelations = relations(clientStrategyProfiles, ({ one }) => ({
  client: one(clients, { fields: [clientStrategyProfiles.clientId], references: [clients.id] }),
}));

export const monthlyReportVersionsRelations = relations(monthlyReportVersions, ({ one }) => ({
  report: one(clientReports, { fields: [monthlyReportVersions.reportId], references: [clientReports.id] }),
}));
