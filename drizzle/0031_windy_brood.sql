CREATE TYPE "public"."video_analysis_source" AS ENUM('platform_url', 'upload', 'frameio');--> statement-breakpoint
CREATE TYPE "public"."video_analysis_status" AS ENUM('queued', 'downloading', 'processing', 'needs_ai', 'partial', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."video_analysis_step" AS ENUM('download', 'probe', 'shots', 'editing', 'transcribe', 'ocr', 'vision', 'hook', 'structure', 'insights');--> statement-breakpoint
CREATE TYPE "public"."video_analysis_step_status" AS ENUM('pending', 'running', 'done', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "video_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"publication_id" uuid,
	"title" varchar(240),
	"platform" "platform",
	"source_type" "video_analysis_source" NOT NULL,
	"source_url" text,
	"external_post_id" varchar(200),
	"caption" text,
	"media_path" text,
	"thumbnail_path" text,
	"mime_type" varchar(80),
	"file_size_bytes" integer,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"fps" integer,
	"aspect_ratio" varchar(12),
	"status" "video_analysis_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"model_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"metrics_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overlays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "video_analyses_client_source_unique" UNIQUE("client_id","source_url")
);
--> statement-breakpoint
CREATE TABLE "video_analysis_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"step" "video_analysis_step" NOT NULL,
	"status" "video_analysis_step_status" DEFAULT 'pending' NOT NULL,
	"detail" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_analysis_steps_unique" UNIQUE("analysis_id","step")
);
--> statement-breakpoint
CREATE TABLE "video_editing_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"total_shots" integer,
	"avg_shot_ms" integer,
	"min_shot_ms" integer,
	"max_shot_ms" integer,
	"cuts_per_10s" integer,
	"tempo_hook_ms" integer,
	"tempo_middle_ms" integer,
	"tempo_end_ms" integer,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_editing_metrics_unique" UNIQUE("analysis_id")
);
--> statement-breakpoint
CREATE TABLE "video_hooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"hook_text" text,
	"types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"form" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_word" varchar(120),
	"time_to_first_word_ms" integer,
	"first_text_ms" integer,
	"shot_count" integer,
	"word_count" integer,
	"corrected_by_id" uuid,
	"corrected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_hooks_unique" UNIQUE("analysis_id")
);
--> statement-breakpoint
CREATE TABLE "video_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"thumbnail_path" text,
	"shot_type" varchar(40),
	"description" text,
	"transition" varchar(40),
	"has_speech" boolean,
	"text_on_screen" text,
	"motion" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_shots_unique" UNIQUE("analysis_id","idx")
);
--> statement-breakpoint
CREATE TABLE "video_structure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_structure_unique" UNIQUE("analysis_id")
);
--> statement-breakpoint
CREATE TABLE "video_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"language" varchar(12),
	"full_text" text,
	"words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wpm" integer,
	"first_word_ms" integer,
	"first_sentence_ms" integer,
	"words_3s" integer,
	"words_5s" integer,
	"words_10s" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_transcripts_unique" UNIQUE("analysis_id")
);
--> statement-breakpoint
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analysis_steps" ADD CONSTRAINT "video_analysis_steps_analysis_id_video_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."video_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_editing_metrics" ADD CONSTRAINT "video_editing_metrics_analysis_id_video_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."video_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_hooks" ADD CONSTRAINT "video_hooks_analysis_id_video_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."video_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_hooks" ADD CONSTRAINT "video_hooks_corrected_by_id_users_id_fk" FOREIGN KEY ("corrected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_shots" ADD CONSTRAINT "video_shots_analysis_id_video_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."video_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_structure" ADD CONSTRAINT "video_structure_analysis_id_video_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."video_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_transcripts" ADD CONSTRAINT "video_transcripts_analysis_id_video_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."video_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_analyses_client_idx" ON "video_analyses" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "video_shots_analysis_idx" ON "video_shots" USING btree ("analysis_id","idx");--> statement-breakpoint
INSERT INTO "permissions" ("key","resource","action","description") VALUES
 ('video_intelligence:read','video_intelligence','read','Video Intelligence-analyses bekijken'),
 ('video_intelligence:run','video_intelligence','run','Video''s toevoegen en laten analyseren')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE p.key IN ('video_intelligence:read','video_intelligence:run')
  AND r.key IN ('owner','admin','project_coordinator')
ON CONFLICT ("role_id","permission_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE p.key = 'video_intelligence:read'
  AND r.key IN ('content_creator','finance')
ON CONFLICT ("role_id","permission_id") DO NOTHING;