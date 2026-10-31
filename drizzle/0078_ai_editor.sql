CREATE TABLE "ad_edit_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"operations" jsonb,
	"response" text,
	"applied_plan_version" integer,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_edit_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"script" text,
	"style_profile_id" uuid,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"phase" varchar(200),
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"plan" jsonb,
	"plan_version" integer DEFAULT 0 NOT NULL,
	"explanation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"qc" jsonb,
	"preview_store" varchar(20),
	"preview_path" text,
	"final_store" varchar(20),
	"final_path" text,
	"final_format" varchar(20),
	"costs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ad_edit_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"filename" varchar(300) NOT NULL,
	"origin" varchar(20) DEFAULT 'upload' NOT NULL,
	"media_store" varchar(20),
	"media_path" text,
	"drive_file_id" varchar(200),
	"size_bytes" bigint,
	"status" varchar(20) DEFAULT 'uploading' NOT NULL,
	"duration_ms" integer,
	"probe" jsonb,
	"transcript" jsonb,
	"analysis" jsonb,
	"analysis_key" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_style_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"media_store" varchar(20),
	"media_path" text,
	"match_profile" varchar(60),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ad_style_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_style_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"media_store" varchar(20),
	"media_path" text,
	"from_project_id" uuid,
	"status" varchar(20) DEFAULT 'uploading' NOT NULL,
	"measurements" jsonb,
	"proposal" jsonb,
	"error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_editor_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(30) NOT NULL,
	"project_id" uuid,
	"reference_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_edit_feedback" ADD CONSTRAINT "ad_edit_feedback_project_id_ad_edit_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ad_edit_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_edit_feedback" ADD CONSTRAINT "ad_edit_feedback_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_edit_projects" ADD CONSTRAINT "ad_edit_projects_style_profile_id_ad_style_profiles_id_fk" FOREIGN KEY ("style_profile_id") REFERENCES "public"."ad_style_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_edit_projects" ADD CONSTRAINT "ad_edit_projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_edit_sources" ADD CONSTRAINT "ad_edit_sources_project_id_ad_edit_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ad_edit_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_style_assets" ADD CONSTRAINT "ad_style_assets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_style_profiles" ADD CONSTRAINT "ad_style_profiles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_style_references" ADD CONSTRAINT "ad_style_references_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_editor_jobs" ADD CONSTRAINT "ai_editor_jobs_project_id_ad_edit_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ad_edit_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_editor_jobs" ADD CONSTRAINT "ai_editor_jobs_reference_id_ad_style_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."ad_style_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_edit_projects_status_idx" ON "ad_edit_projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ad_edit_sources_project_idx" ON "ad_edit_sources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ad_style_profiles_name_idx" ON "ad_style_profiles" USING btree ("name","version");--> statement-breakpoint
CREATE INDEX "ai_editor_jobs_status_idx" ON "ai_editor_jobs" USING btree ("status","created_at");