CREATE TABLE "kb_asset_parts" (
	"asset_id" uuid NOT NULL,
	"part_no" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "kb_asset_parts_unique" UNIQUE("asset_id","part_no")
);
--> statement-breakpoint
CREATE TABLE "kb_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(16) NOT NULL,
	"file_name" varchar(400) NOT NULL,
	"content_type" varchar(160) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64),
	"is_complete" boolean DEFAULT false NOT NULL,
	"source_ref" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_ref" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kb_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_asset_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"allowed_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"source_ref" text,
	"source_url" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kb_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(40) NOT NULL,
	"status" varchar(20) NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_lesson_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"content" jsonb NOT NULL,
	"video_url" text,
	"resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edited_by_id" uuid,
	"note" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"chapter_id" uuid,
	"title" varchar(300) NOT NULL,
	"content" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"video_url" text,
	"video_asset_id" uuid,
	"resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"source_ref" text,
	"source_url" text,
	"migration_notes" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kb_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(16) DEFAULT 'user' NOT NULL,
	CONSTRAINT "kb_progress_user_lesson_unique" UNIQUE("user_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "kb_asset_parts" ADD CONSTRAINT "kb_asset_parts_asset_id_kb_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."kb_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_assets" ADD CONSTRAINT "kb_assets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chapters" ADD CONSTRAINT "kb_chapters_course_id_kb_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."kb_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chapters" ADD CONSTRAINT "kb_chapters_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_courses" ADD CONSTRAINT "kb_courses_cover_asset_id_kb_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."kb_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_courses" ADD CONSTRAINT "kb_courses_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_lesson_revisions" ADD CONSTRAINT "kb_lesson_revisions_lesson_id_kb_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."kb_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_lesson_revisions" ADD CONSTRAINT "kb_lesson_revisions_edited_by_id_users_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_lessons" ADD CONSTRAINT "kb_lessons_course_id_kb_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."kb_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_lessons" ADD CONSTRAINT "kb_lessons_chapter_id_kb_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."kb_chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_lessons" ADD CONSTRAINT "kb_lessons_video_asset_id_kb_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."kb_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_lessons" ADD CONSTRAINT "kb_lessons_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_progress" ADD CONSTRAINT "kb_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_progress" ADD CONSTRAINT "kb_progress_lesson_id_kb_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."kb_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_assets_sha_idx" ON "kb_assets" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "kb_chapters_course_idx" ON "kb_chapters" USING btree ("course_id","sort_order");--> statement-breakpoint
CREATE INDEX "kb_courses_sort_idx" ON "kb_courses" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "kb_lesson_revisions_lesson_idx" ON "kb_lesson_revisions" USING btree ("lesson_id","created_at");--> statement-breakpoint
CREATE INDEX "kb_lessons_course_idx" ON "kb_lessons" USING btree ("course_id","sort_order");--> statement-breakpoint
CREATE INDEX "kb_lessons_chapter_idx" ON "kb_lessons" USING btree ("chapter_id","sort_order");--> statement-breakpoint
CREATE INDEX "kb_progress_user_idx" ON "kb_progress" USING btree ("user_id");