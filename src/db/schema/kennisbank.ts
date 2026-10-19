import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
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
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Shortclips Kennisbank (vervanger van de Skool Classroom)
 *
 * Structuur: cursus → (hoofdstuk) → les. Iedere laag wordt los opgeslagen,
 * met een bronverwijzing naar het oorspronkelijke Skool-onderdeel, zodat de
 * herkomst van elke SOP altijd herleidbaar blijft (ook voor de interne AI).
 *
 * Lesinhoud wordt bewaard als ProseMirror/TipTap-JSON: exact het formaat dat
 * Skool zelf gebruikt. Zo blijft alle opmaak (koppen, vet, cursief, lijsten,
 * scheidingslijnen, links, afbeeldingen) verliesvrij behouden.
 *
 * Bestanden (afbeeldingen, PDF's, video's) staan in `kb_assets`, in onze eigen
 * database, dus onafhankelijk van Skool.
 * ------------------------------------------------------------------ */

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});

export type KbDoc = { type: "doc"; content?: unknown[] } & Record<string, unknown>;

export type KbResource = {
  title: string;
  /** Verwijzing naar kb_assets (bestand) óf een externe link. */
  assetId?: string | null;
  url?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  /** Alleen bij geïmporteerde bijlagen: het oorspronkelijke Skool file-id. */
  skoolFileId?: string | null;
};

export const kbAssets = pgTable(
  "kb_assets",
  {
    id: pk(),
    /** image | file | video */
    kind: varchar("kind", { length: 16 }).notNull(),
    fileName: varchar("file_name", { length: 400 }).notNull(),
    contentType: varchar("content_type", { length: 160 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    /** Wordt gevuld zodra alle delen binnen zijn (zie `isComplete`). */
    sha256: varchar("sha256", { length: 64 }),
    isComplete: boolean("is_complete").notNull().default(false),
    /** Herkomst (bijv. de oorspronkelijke Skool-URL of Skool file-id). */
    sourceRef: text("source_ref"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("kb_assets_sha_idx").on(t.sha256)],
);

/**
 * De bytes van een bestand, in delen van max. ~3 MB. Zo passen uploads en
 * downloads binnen de limieten van serverless functies (downloads worden
 * gestreamd en ondersteunen Range-verzoeken voor video en PDF).
 */
export const kbAssetParts = pgTable(
  "kb_asset_parts",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => kbAssets.id, { onDelete: "cascade" }),
    partNo: integer("part_no").notNull(),
    byteSize: integer("byte_size").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [unique("kb_asset_parts_unique").on(t.assetId, t.partNo)],
);

export const KB_PART_SIZE = 3 * 1024 * 1024;

export const kbCourses = pgTable(
  "kb_courses",
  {
    id: pk(),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description").notNull().default(""),
    coverAssetId: uuid("cover_asset_id").references(() => kbAssets.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Afgeschermd (zoals "privé" in Skool): alleen de eigenaar en de rollen in
     * `allowedRoles` zien deze cursus. Leeg = alleen de eigenaar.
     */
    isRestricted: boolean("is_restricted").notNull().default(false),
    allowedRoles: jsonb("allowed_roles").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    isPublished: boolean("is_published").notNull().default(true),
    /** Bronverwijzing, bijv. "skool:course:<id>". */
    sourceRef: text("source_ref"),
    sourceUrl: text("source_url"),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("kb_courses_sort_idx").on(t.sortOrder)],
);

export const kbChapters = pgTable(
  "kb_chapters",
  {
    id: pk(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => kbCourses.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 300 }).notNull(),
    /** Positie binnen de cursus (gedeeld met losse lessen op cursusniveau). */
    sortOrder: integer("sort_order").notNull().default(0),
    sourceRef: text("source_ref"),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("kb_chapters_course_idx").on(t.courseId, t.sortOrder)],
);

export const kbLessons = pgTable(
  "kb_lessons",
  {
    id: pk(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => kbCourses.id, { onDelete: "cascade" }),
    /** `null` = les direct onder de cursus, zonder hoofdstuk. */
    chapterId: uuid("chapter_id").references(() => kbChapters.id, { onDelete: "set null" }),
    title: varchar("title", { length: 300 }).notNull(),
    content: jsonb("content").$type<KbDoc>().notNull().default(sql`'{"type":"doc","content":[]}'::jsonb`),
    /** Platte tekst van de inhoud: voor zoeken en (later) de interne AI. */
    contentText: text("content_text").notNull().default(""),
    videoUrl: text("video_url"),
    videoAssetId: uuid("video_asset_id").references(() => kbAssets.id, { onDelete: "set null" }),
    resources: jsonb("resources").$type<KbResource[]>().notNull().default(sql`'[]'::jsonb`),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    /** Bronverwijzing naar de oorspronkelijke SOP, bijv. "skool:module:<id>". */
    sourceRef: text("source_ref"),
    sourceUrl: text("source_url"),
    /** Wat nog niet uit Skool overgezet kon worden (zichtbaar voor de eigenaar). */
    migrationNotes: text("migration_notes"),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("kb_lessons_course_idx").on(t.courseId, t.sortOrder),
    index("kb_lessons_chapter_idx").on(t.chapterId, t.sortOrder),
  ],
);

/** Elke opgeslagen versie van een les, zodat niets ongemerkt verloren gaat. */
export const kbLessonRevisions = pgTable(
  "kb_lesson_revisions",
  {
    id: pk(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => kbLessons.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 300 }).notNull(),
    content: jsonb("content").$type<KbDoc>().notNull(),
    videoUrl: text("video_url"),
    resources: jsonb("resources").$type<KbResource[]>().notNull().default(sql`'[]'::jsonb`),
    editedById: uuid("edited_by_id").references(() => users.id, { onDelete: "set null" }),
    note: varchar("note", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("kb_lesson_revisions_lesson_idx").on(t.lessonId, t.createdAt)],
);

/** Persoonlijke voortgang: welke lessen heeft iemand afgerond. */
export const kbProgress = pgTable(
  "kb_progress",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => kbLessons.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().default(sql`now()`),
    /** "user" = zelf afgevinkt; "skool" = overgenomen uit Skool. */
    source: varchar("source", { length: 16 }).notNull().default("user"),
  },
  (t) => [unique("kb_progress_user_lesson_unique").on(t.userId, t.lessonId), index("kb_progress_user_idx").on(t.userId)],
);

/** Logboek van de migratie uit Skool (één rij per importrun). */
export const kbImportRuns = pgTable("kb_import_runs", {
  id: pk(),
  source: varchar("source", { length: 40 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});
