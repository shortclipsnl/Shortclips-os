import { relations, sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import {
  platformEnum,
  videoAnalysisSourceEnum,
  videoAnalysisStatusEnum,
  videoAnalysisStepEnum,
  videoAnalysisStepStatusEnum,
} from "./enums";
import { clients } from "./clients";
import { users } from "./identity";
import { deliverables } from "./video";
import { publications } from "./analytics";

/* ------------------------------------------------------------------ *
 * Video Intelligence — diepe analyse van organische short video's.
 *
 * Gemeten feiten (shots, transcript, montage) staan in deze tabellen;
 * AI-interpretaties (conclusies/adviezen) gaan naar de generieke
 * `ai_outputs`-tabel met tool = "video_intelligence". Alles is strikt per
 * klant gescheiden (clientId + scopeToClients in de datalaag).
 * ------------------------------------------------------------------ */

/** Eén geanalyseerde video. */
export const videoAnalyses = pgTable(
  "video_analyses",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Koppeling aan een bestaande video/publicatie indien bekend. */
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, { onDelete: "set null" }),
    publicationId: uuid("publication_id").references(() => publications.id, { onDelete: "set null" }),

    title: varchar("title", { length: 240 }),
    platform: platformEnum("platform"),
    sourceType: videoAnalysisSourceEnum("source_type").notNull(),
    /** Publieke platform-URL (bij platform_url). */
    sourceUrl: text("source_url"),
    externalPostId: varchar("external_post_id", { length: 200 }),
    caption: text("caption"),

    /** Lokaal pad naar het opgehaalde/geüploade bronbestand en de hoofd-thumbnail. */
    mediaPath: text("media_path"),
    thumbnailPath: text("thumbnail_path"),
    mimeType: varchar("mime_type", { length: 80 }),
    fileSizeBytes: integer("file_size_bytes"),

    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    fps: integer("fps"),
    aspectRatio: varchar("aspect_ratio", { length: 12 }),

    /** Handmatige sectie-correctie (overschrijft de heuristiek/AI): grens hook↔middenstuk en middenstuk↔CTA in ms. */
    manualHookEndMs: integer("manual_hook_end_ms"),
    manualCtaStartMs: integer("manual_cta_start_ms"),
    sectionsCorrectedById: uuid("sections_corrected_by_id").references(() => users.id, { onDelete: "set null" }),

    status: videoAnalysisStatusEnum("status").notNull().default("queued"),
    error: text("error"),
    /** Welk model/toolversie elke stap deed (reproduceerbaarheid). */
    modelVersions: jsonb("model_versions").notNull().default(sql`'{}'::jsonb`),
    /** Geschatte AI-/verwerkingskosten in eurocent. */
    costCents: integer("cost_cents").notNull().default(0),
    /** Momentopname van de platformcijfers bij analyse (uit social_metrics). */
    metricsSnapshot: jsonb("metrics_snapshot").notNull().default(sql`'{}'::jsonb`),
    /** Teksten-in-beeld (fase 1 als jsonb; aparte tabel pas als filteren nodig is). */
    overlays: jsonb("overlays").notNull().default(sql`'[]'::jsonb`),

    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("video_analyses_client_idx").on(t.clientId, t.status),
    // Geen dubbele import van dezelfde bron per klant.
    unique("video_analyses_client_source_unique").on(t.clientId, t.sourceUrl),
  ],
);

/** Stapstatus van de verwerkingspijplijn — resumable + eerlijke voortgang. */
export const videoAnalysisSteps = pgTable(
  "video_analysis_steps",
  {
    id: pk(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => videoAnalyses.id, { onDelete: "cascade" }),
    step: videoAnalysisStepEnum("step").notNull(),
    status: videoAnalysisStepStatusEnum("status").notNull().default("pending"),
    /** Reden bij skipped/failed, bijv. "ffmpeg niet geïnstalleerd". */
    detail: text("detail"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [unique("video_analysis_steps_unique").on(t.analysisId, t.step)],
);

/** Automatisch gedetecteerde shots (beeldfragmenten tussen montageovergangen). */
export const videoShots = pgTable(
  "video_shots",
  {
    id: pk(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => videoAnalyses.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    thumbnailPath: text("thumbnail_path"),
    /** Door AI gevuld (vision): close_up/wide/talking_head/b_roll/... */
    shotType: varchar("shot_type", { length: 40 }),
    description: text("description"),
    transition: varchar("transition", { length: 40 }),
    hasSpeech: boolean("has_speech"),
    textOnScreen: text("text_on_screen"),
    motion: varchar("motion", { length: 40 }),
    ...timestamps,
  },
  (t) => [
    index("video_shots_analysis_idx").on(t.analysisId, t.idx),
    unique("video_shots_unique").on(t.analysisId, t.idx),
  ],
);

/** Transcript met woordtijden (Whisper). */
export const videoTranscripts = pgTable(
  "video_transcripts",
  {
    id: pk(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => videoAnalyses.id, { onDelete: "cascade" }),
    language: varchar("language", { length: 12 }),
    fullText: text("full_text"),
    /** [{ w, start, end }] in ms. */
    words: jsonb("words").notNull().default(sql`'[]'::jsonb`),
    segments: jsonb("segments").notNull().default(sql`'[]'::jsonb`),
    wpm: integer("wpm"),
    firstWordMs: integer("first_word_ms"),
    firstSentenceMs: integer("first_sentence_ms"),
    /** Woorden gesproken in de eerste 3/5/10 seconden. */
    words3s: integer("words_3s"),
    words5s: integer("words_5s"),
    words10s: integer("words_10s"),
    ...timestamps,
  },
  (t) => [unique("video_transcripts_unique").on(t.analysisId)],
);

/** Hookanalyse (opening van de video). */
export const videoHooks = pgTable(
  "video_hooks",
  {
    id: pk(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => videoAnalyses.id, { onDelete: "cascade" }),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    hookText: text("hook_text"),
    types: jsonb("types").notNull().default(sql`'[]'::jsonb`),
    form: jsonb("form").notNull().default(sql`'[]'::jsonb`),
    elements: jsonb("elements").notNull().default(sql`'[]'::jsonb`),
    firstWord: varchar("first_word", { length: 120 }),
    timeToFirstWordMs: integer("time_to_first_word_ms"),
    firstTextMs: integer("first_text_ms"),
    shotCount: integer("shot_count"),
    wordCount: integer("word_count"),
    /** Menselijke correctie blijft bewaard (spec 22). */
    correctedById: uuid("corrected_by_id").references(() => users.id, { onDelete: "set null" }),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("video_hooks_unique").on(t.analysisId)],
);

/** Montageanalyse. */
export const videoEditingMetrics = pgTable(
  "video_editing_metrics",
  {
    id: pk(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => videoAnalyses.id, { onDelete: "cascade" }),
    totalShots: integer("total_shots"),
    avgShotMs: integer("avg_shot_ms"),
    minShotMs: integer("min_shot_ms"),
    maxShotMs: integer("max_shot_ms"),
    cutsPer10s: integer("cuts_per_10s"),
    tempoHookMs: integer("tempo_hook_ms"),
    tempoMiddleMs: integer("tempo_middle_ms"),
    tempoEndMs: integer("tempo_end_ms"),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [unique("video_editing_metrics_unique").on(t.analysisId)],
);

/** Inhoudelijke structuur (hook/intro/midden/uitleg/demo/payoff/cta). */
export const videoStructure = pgTable(
  "video_structure",
  {
    id: pk(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => videoAnalyses.id, { onDelete: "cascade" }),
    segments: jsonb("segments").notNull().default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (t) => [unique("video_structure_unique").on(t.analysisId)],
);

/* ---- Relaties ---- */

export const videoAnalysesRelations = relations(videoAnalyses, ({ one, many }) => ({
  client: one(clients, { fields: [videoAnalyses.clientId], references: [clients.id] }),
  deliverable: one(deliverables, { fields: [videoAnalyses.deliverableId], references: [deliverables.id] }),
  steps: many(videoAnalysisSteps),
  shots: many(videoShots),
  transcript: one(videoTranscripts),
  hook: one(videoHooks),
  editing: one(videoEditingMetrics),
  structure: one(videoStructure),
}));

export const videoAnalysisStepsRelations = relations(videoAnalysisSteps, ({ one }) => ({
  analysis: one(videoAnalyses, { fields: [videoAnalysisSteps.analysisId], references: [videoAnalyses.id] }),
}));

export const videoShotsRelations = relations(videoShots, ({ one }) => ({
  analysis: one(videoAnalyses, { fields: [videoShots.analysisId], references: [videoAnalyses.id] }),
}));
