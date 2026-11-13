import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";
import { deliverables, frameAssets } from "./video";

/* ------------------------------------------------------------------ *
 * Videobeoordeling in het klantportaal (feedback met tijdcode +
 * goedkeuring per video), gekoppeld aan de Frame.io-bibliotheek.
 *
 * Frame.io blijft de plek van het bestand en van het werk van de editor;
 * deze tabellen leggen vast wat de klant in het portaal doet en of dat al
 * in Frame.io staat (syncStatus). Elke opmerking hoort bij één versie
 * (mediaFileId): feedback op een oude versie komt nooit bij een nieuwe.
 * ------------------------------------------------------------------ */

export const portalVideoComments = pgTable(
  "portal_video_comments",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    frameAssetId: uuid("frame_asset_id").notNull().references(() => frameAssets.id, { onDelete: "cascade" }),
    /** Het Frame-bestand (de versie) waarop de opmerking is geplaatst. */
    mediaFileId: varchar("media_file_id", { length: 200 }).notNull(),
    versionNumber: integer("version_number").notNull().default(1),
    /** Positie in de video in milliseconden; null = algemene opmerking. */
    timecodeMs: integer("timecode_ms"),
    body: text("body").notNull(),
    /** Reactie op een andere opmerking (zelfde video en versie). */
    parentId: uuid("parent_id"),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: varchar("author_name", { length: 160 }),
    /** `client` = klant in het portaal, `shortclips` = editor/team (via Frame.io). */
    authorKind: varchar("author_kind", { length: 16 }).notNull().default("client"),
    /** `portal` of `frameio`. */
    source: varchar("source", { length: 16 }).notNull().default("portal"),
    /** `draft` = nog niet verstuurd (alleen de klant ziet het), `submitted` = verstuurd. */
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submissionId: uuid("submission_id"),
    /** Synchronisatie met Frame.io: `none` (concept), `pending`, `synced`, `failed`. */
    syncStatus: varchar("sync_status", { length: 16 }).notNull().default("none"),
    syncAttempts: integer("sync_attempts").notNull().default(0),
    syncError: text("sync_error"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    frameCommentId: varchar("frame_comment_id", { length: 200 }),
    /** Door de editor in Frame.io als afgehandeld gemarkeerd. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("portal_video_comments_asset_idx").on(t.frameAssetId, t.mediaFileId),
    index("portal_video_comments_client_idx").on(t.clientId, t.status),
    index("portal_video_comments_sync_idx").on(t.syncStatus),
    unique("portal_video_comments_frame_unique").on(t.frameCommentId),
  ],
);

/** Goedkeuring door de klant van één versie van één video. */
export const portalVideoApprovals = pgTable(
  "portal_video_approvals",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    frameAssetId: uuid("frame_asset_id").notNull().references(() => frameAssets.id, { onDelete: "cascade" }),
    mediaFileId: varchar("media_file_id", { length: 200 }).notNull(),
    versionNumber: integer("version_number").notNull().default(1),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().default(sql`now()`),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedByName: varchar("approved_by_name", { length: 160 }),
    /** Status "Approved" in Frame.io gezet (of de fout als dat niet lukte). */
    frameSyncedAt: timestamp("frame_synced_at", { withTimezone: true }),
    frameSyncError: text("frame_sync_error"),
    ...timestamps,
  },
  (t) => [
    unique("portal_video_approvals_version_unique").on(t.frameAssetId, t.mediaFileId),
    index("portal_video_approvals_client_idx").on(t.clientId),
  ],
);

/** Eén keer "Feedback versturen" = één bundel = één melding voor het team. */
export const portalFeedbackSubmissions = pgTable(
  "portal_feedback_submissions",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    sessionFolderId: varchar("session_folder_id", { length: 200 }),
    sessionName: varchar("session_name", { length: 240 }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, { onDelete: "set null" }),
    commentCount: integer("comment_count").notNull().default(0),
    videoCount: integer("video_count").notNull().default(0),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    submittedByName: varchar("submitted_by_name", { length: 160 }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("portal_feedback_submissions_client_idx").on(t.clientId, t.createdAt)],
);
