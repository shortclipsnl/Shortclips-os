import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Shortclips AI Editor — automatische montage van de eigen advertenties.
 *
 * - ad_style_profiles: het montageprofiel "Shortclips Ads Style", versioned.
 *   Precies één versie is actief; een wijziging maakt altijd een nieuwe versie.
 * - ad_style_references / ad_style_assets: referentievideo's (met gemeten
 *   kenmerken) en hulpbestanden (muziek, LUT's) uit Stijlbeheer.
 * - ad_edit_projects / ad_edit_sources: een advertentie in de maak met de
 *   ruwe camerabestanden.
 * - ad_edit_feedback: feedback op de preview, met de toegepaste bewerkingen.
 * - ai_editor_jobs: wachtrij voor het zware werk. De online hub zet alleen
 *   jobs klaar; de verwerk-server (npm run ai-editor:worker) voert ze uit.
 *
 * Bewust niet klantgebonden: dit is voor de eigen advertenties van Shortclips.
 * Toegang loopt via de rechten ai_editor:read / :run / :style.
 * ------------------------------------------------------------------ */

export const adStyleProfiles = pgTable(
  "ad_style_profiles",
  {
    id: pk(),
    name: varchar("name", { length: 120 }).notNull(),
    version: integer("version").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    /** Volledige stijlconfiguratie (zie src/server/ai-editor/style-profile.ts). */
    config: jsonb("config").notNull(),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("ad_style_profiles_name_idx").on(t.name, t.version)],
);

export const adStyleReferences = pgTable("ad_style_references", {
  id: pk(),
  title: varchar("title", { length: 240 }).notNull(),
  mediaStore: varchar("media_store", { length: 20 }),
  mediaPath: text("media_path"),
  /** Herkomst: upload, of een project dat als referentie is gemarkeerd. */
  fromProjectId: uuid("from_project_id"),
  status: varchar("status", { length: 20 }).notNull().default("uploading"),
  /** Gemeten kenmerken (ritme, audio, kleur). */
  measurements: jsonb("measurements"),
  /** Voorstel: welke profielwaarden zouden veranderen bij overnemen. */
  proposal: jsonb("proposal"),
  error: text("error"),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
  ...softDelete,
});

export const adStyleAssets = pgTable("ad_style_assets", {
  id: pk(),
  /** music | lut */
  kind: varchar("kind", { length: 20 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  mediaStore: varchar("media_store", { length: 20 }),
  mediaPath: text("media_path"),
  /** Bij een LUT: voor welk opnameprofiel (bijv. "slog3", "vlog", "clog"). */
  matchProfile: varchar("match_profile", { length: 60 }),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
  ...softDelete,
});

export const adEditProjects = pgTable(
  "ad_edit_projects",
  {
    id: pk(),
    title: varchar("title", { length: 240 }).notNull(),
    /** Optioneel script: bepaalt de bedoelde tekst en volgorde. */
    script: text("script"),
    styleProfileId: uuid("style_profile_id").references(() => adStyleProfiles.id, { onDelete: "set null" }),
    /** draft | queued | processing | review | needs_choice | failed | exported */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    /** Huidige fase voor de voortgangsweergave. */
    phase: varchar("phase", { length: 200 }),
    progress: integer("progress").notNull().default(0),
    error: text("error"),
    /** Het montageplan (edit decision list) — de bron van waarheid voor de render. */
    plan: jsonb("plan"),
    planVersion: integer("plan_version").notNull().default(0),
    /** Uitleg van de montagekeuzes, voor het team. */
    explanation: jsonb("explanation").notNull().default(sql`'[]'::jsonb`),
    /** Uitkomst van de kwaliteitscontrole. */
    qc: jsonb("qc"),
    previewStore: varchar("preview_store", { length: 20 }),
    previewPath: text("preview_path"),
    finalStore: varchar("final_store", { length: 20 }),
    finalPath: text("final_path"),
    finalFormat: varchar("final_format", { length: 20 }),
    /** Kostenregistratie (AI, rendering, opslag) in eurocent + onderbouwing. */
    costs: jsonb("costs").notNull().default(sql`'{}'::jsonb`),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("ad_edit_projects_status_idx").on(t.status)],
);

export const adEditSources = pgTable(
  "ad_edit_sources",
  {
    id: pk(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => adEditProjects.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 300 }).notNull(),
    /** upload (disk/supabase) of drive (Google Drive-bestand). */
    origin: varchar("origin", { length: 20 }).notNull().default("upload"),
    mediaStore: varchar("media_store", { length: 20 }),
    mediaPath: text("media_path"),
    driveFileId: varchar("drive_file_id", { length: 200 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** uploading | ready | analyzed | failed */
    status: varchar("status", { length: 20 }).notNull().default("uploading"),
    durationMs: integer("duration_ms"),
    /** Technische gegevens (resolutie, fps, kleurprofiel, log-detectie). */
    probe: jsonb("probe"),
    /** Woordtijden uit de transcriptie. */
    transcript: jsonb("transcript"),
    /** Afgeleide analyse: spraak-aandeel, rol (spreker/b-roll), kleur, audio. */
    analysis: jsonb("analysis"),
    /** Hash van het bestand + modelversie: analyse wordt hergebruikt. */
    analysisKey: varchar("analysis_key", { length: 120 }),
    ...timestamps,
  },
  (t) => [index("ad_edit_sources_project_idx").on(t.projectId)],
);

export const adEditFeedback = pgTable("ad_edit_feedback", {
  id: pk(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => adEditProjects.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  /** queued | applied | not_understood | failed */
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  /** De vertaalde bewerkingen op het montageplan. */
  operations: jsonb("operations"),
  response: text("response"),
  appliedPlanVersion: integer("applied_plan_version"),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

export const aiEditorJobs = pgTable(
  "ai_editor_jobs",
  {
    id: pk(),
    /** generate | revise | export | analyze_reference */
    kind: varchar("kind", { length: 30 }).notNull(),
    projectId: uuid("project_id").references(() => adEditProjects.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id").references(() => adStyleReferences.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    /** queued | processing | done | failed */
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("ai_editor_jobs_status_idx").on(t.status, t.createdAt)],
);
