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
  approvalKindEnum,
  approvalStatusEnum,
  commentVisibilityEnum,
  videoStatusEnum,
} from "./enums";
import { clients } from "./clients";
import { users } from "./identity";
import { productionDays, projects, scripts } from "./production";

/* ------------------------------------------------------------------ *
 * Deliverables = de video's. Hart van de pipeline.
 * ------------------------------------------------------------------ */

export const deliverables = pgTable(
  "deliverables",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    scriptId: uuid("script_id").references(() => scripts.id, {
      onDelete: "set null",
    }),
    productionDayId: uuid("production_day_id").references(
      () => productionDays.id,
      { onDelete: "set null" },
    ),
    title: varchar("title", { length: 240 }).notNull(),
    status: videoStatusEnum("status").notNull().default("recorded"),
    /** Wanneer de video de huidige status binnenkwam — voedt "wacht al X dagen". */
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    editorId: uuid("editor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueOn: date("due_on"),
    /** Hoe de deadline is bepaald: "auto" = berekend uit opnamedatum + 14
     *  werkdagen; "manual" = handmatig vastgezet (wordt niet overschreven). */
    dueOnSource: varchar("due_on_source", { length: 8 }).notNull().default("auto"),
    /** Heuristisch voorgestelde opnamedag (nog te bevestigen in het
     *  koppel-controleoverzicht). linkConfidence: high/medium/low. */
    suggestedProductionDayId: uuid("suggested_production_day_id").references(
      () => productionDays.id,
      { onDelete: "set null" },
    ),
    linkConfidence: varchar("link_confidence", { length: 8 }),
    /** true zodra iemand de koppeling heeft bevestigd of afgewezen. */
    linkReviewed: boolean("link_reviewed").notNull().default(false),
    /** Verwachte publicatiedatum; de echte planning staat in content_calendar. */
    plannedPublishOn: date("planned_publish_on"),
    aspectRatio: varchar("aspect_ratio", { length: 12 }).notNull().default("9:16"),
    durationSeconds: integer("duration_seconds"),
    thumbnailUrl: text("thumbnail_url"),
    frameAssetId: varchar("frame_asset_id", { length: 200 }),
    frameProjectId: varchar("frame_project_id", { length: 200 }),
    frameUrl: text("frame_url"),
    driveFolderId: varchar("drive_folder_id", { length: 200 }),
    currentVersion: integer("current_version").notNull().default(0),
    /** Tellers voor doorlooptijd- en kwaliteitsanalyse. */
    internalRevisionRounds: integer("internal_revision_rounds")
      .notNull()
      .default(0),
    clientRevisionRounds: integer("client_revision_rounds").notNull().default(0),
    editCost: numeric("edit_cost", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    briefing: text("briefing"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("deliverables_client_idx").on(t.clientId, t.status),
    index("deliverables_status_idx").on(t.status, t.statusChangedAt),
    index("deliverables_editor_idx").on(t.editorId, t.status),
    index("deliverables_due_idx").on(t.dueOn),
    index("deliverables_frame_asset_idx").on(t.frameAssetId),
  ],
);

export const videoVersions = pgTable(
  "video_versions",
  {
    id: pk(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    label: varchar("label", { length: 120 }),
    /** Externe bron blijft leidend voor het bestand zelf (Frame.io). */
    frameAssetId: varchar("frame_asset_id", { length: 200 }),
    fileUrl: text("file_url"),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: integer("duration_seconds"),
    fileSizeBytes: numeric("file_size_bytes", { precision: 20, scale: 0 }),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    isCurrent: boolean("is_current").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("video_versions_unique").on(t.deliverableId, t.versionNumber),
    index("video_versions_deliverable_idx").on(t.deliverableId),
    index("video_versions_frame_idx").on(t.frameAssetId),
  ],
);

/* ------------------------------------------------------------------ *
 * Review: threads + comments (intern vs. klant strikt gescheiden)
 * ------------------------------------------------------------------ */

export const reviewThreads = pgTable(
  "review_threads",
  {
    id: pk(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    videoVersionId: uuid("video_version_id").references(() => videoVersions.id, {
      onDelete: "set null",
    }),
    /**
     * `internal` = alleen ShortClips. `client` = ook zichtbaar in het portaal.
     * Deze kolom is de enige bron voor die scheiding; de data-laag filtert erop.
     */
    visibility: commentVisibilityEnum("visibility").notNull().default("internal"),
    /** Positie in de video, in milliseconden. */
    timecodeMs: integer("timecode_ms"),
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    frameCommentId: varchar("frame_comment_id", { length: 200 }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("review_threads_deliverable_idx").on(t.deliverableId, t.visibility),
    index("review_threads_frame_idx").on(t.frameCommentId),
  ],
);

export const reviewComments = pgTable(
  "review_comments",
  {
    id: pk(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => reviewThreads.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** Interne gebruiker óf klantcontact — precies één van beide. */
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authorContactId: uuid("author_contact_id"),
    authorName: varchar("author_name", { length: 160 }),
    source: varchar("source", { length: 32 }).notNull().default("shortclips_os"),
    frameCommentId: varchar("frame_comment_id", { length: 200 }),
    timecodeMs: integer("timecode_ms"),
    attachments: jsonb("attachments").notNull().default(sql`'[]'::jsonb`),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("review_comments_thread_idx").on(t.threadId),
    unique("review_comments_frame_unique").on(t.frameCommentId),
  ],
);

/* ------------------------------------------------------------------ *
 * Goedkeuringen (script, video, publicatie, rapport)
 * ------------------------------------------------------------------ */

export const approvals = pgTable(
  "approvals",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: approvalKindEnum("kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    requestedById: uuid("requested_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedByContactId: uuid("decided_by_contact_id"),
    comment: text("comment"),
    source: varchar("source", { length: 32 }).notNull().default("portal"),
    ...timestamps,
  },
  (t) => [
    index("approvals_entity_idx").on(t.kind, t.entityId),
    index("approvals_client_idx").on(t.clientId, t.status),
  ],
);

/* ------------------------------------------------------------------ *
 * Editors: toewijzingen en kosten
 * ------------------------------------------------------------------ */

export const editors = pgTable(
  "editors",
  {
    id: pk(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    email: varchar("email", { length: 320 }),
    isFreelance: boolean("is_freelance").notNull().default(true),
    /** Standaardvergoeding per video, gebruikt als kosten-suggestie. */
    ratePerVideo: numeric("rate_per_video", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    ratePerHour: numeric("rate_per_hour", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    weeklyCapacity: integer("weekly_capacity").notNull().default(0),
    specialties: jsonb("specialties").notNull().default(sql`'[]'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("editors_user_idx").on(t.userId)],
);

export const editorAssignments = pgTable(
  "editor_assignments",
  {
    id: pk(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    dueOn: date("due_on"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Doorlooptijd in uren, ingevuld bij oplevering. */
    turnaroundHours: integer("turnaround_hours"),
    briefing: text("briefing"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("editor_assignments_editor_idx").on(t.editorId, t.isActive),
    index("editor_assignments_deliverable_idx").on(t.deliverableId),
  ],
);

export const editorCosts = pgTable(
  "editor_costs",
  {
    id: pk(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    /** Periode YYYY-MM waarin de kosten vallen. */
    period: varchar("period", { length: 7 }).notNull(),
    description: varchar("description", { length: 240 }),
    isPaid: boolean("is_paid").notNull().default(false),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("editor_costs_editor_idx").on(t.editorId, t.period),
    index("editor_costs_client_idx").on(t.clientId, t.period),
  ],
);

/* ------------------------------------------------------------------ *
 * Relaties
 * ------------------------------------------------------------------ */

export const deliverablesRelations = relations(deliverables, ({ one, many }) => ({
  client: one(clients, {
    fields: [deliverables.clientId],
    references: [clients.id],
  }),
  script: one(scripts, {
    fields: [deliverables.scriptId],
    references: [scripts.id],
  }),
  productionDay: one(productionDays, {
    fields: [deliverables.productionDayId],
    references: [productionDays.id],
  }),
  editor: one(users, { fields: [deliverables.editorId], references: [users.id] }),
  versions: many(videoVersions),
  threads: many(reviewThreads),
}));

export const videoVersionsRelations = relations(videoVersions, ({ one }) => ({
  deliverable: one(deliverables, {
    fields: [videoVersions.deliverableId],
    references: [deliverables.id],
  }),
}));

export const reviewThreadsRelations = relations(reviewThreads, ({ one, many }) => ({
  deliverable: one(deliverables, {
    fields: [reviewThreads.deliverableId],
    references: [deliverables.id],
  }),
  comments: many(reviewComments),
}));

export const reviewCommentsRelations = relations(reviewComments, ({ one }) => ({
  thread: one(reviewThreads, {
    fields: [reviewComments.threadId],
    references: [reviewThreads.id],
  }),
}));

export const editorsRelations = relations(editors, ({ one, many }) => ({
  user: one(users, { fields: [editors.userId], references: [users.id] }),
  assignments: many(editorAssignments),
  costs: many(editorCosts),
}));

export const editorAssignmentsRelations = relations(
  editorAssignments,
  ({ one }) => ({
    editor: one(editors, {
      fields: [editorAssignments.editorId],
      references: [editors.id],
    }),
    deliverable: one(deliverables, {
      fields: [editorAssignments.deliverableId],
      references: [deliverables.id],
    }),
  }),
);

/* ------------------------------------------------------------------ *
 * Editor-tarieven en capaciteit (eigen editing dashboard)
 * ------------------------------------------------------------------ */

/**
 * Per editor een vast tarief per video en een weekcapaciteit. De editingkosten
 * worden hiermee automatisch berekend (aantal video's × tarief), met de
 * mogelijkheid tot een afwijkend tarief per project via deliverables.editCost.
 */
export const editorRates = pgTable("editor_rates", {
  id: pk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Standaardtarief per gemonteerde video (ex btw). */
  ratePerVideo: numeric("rate_per_video", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Hoeveel video's deze editor per week aankan (voor de capaciteitsverdeling). */
  capacityPerWeek: integer("capacity_per_week").notNull().default(0),
  ...timestamps,
}, (t) => [unique("editor_rates_user_unique").on(t.userId)]);
