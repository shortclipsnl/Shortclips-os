-- Videobeoordeling klantportaal. Idempotent (IF NOT EXISTS), zodat de migratie
-- veilig is bij parallelle branches en handmatig vooraf toepassen.
CREATE TABLE IF NOT EXISTS "portal_feedback_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"session_folder_id" varchar(200),
	"session_name" varchar(240),
	"deliverable_id" uuid,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"video_count" integer DEFAULT 0 NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_by_name" varchar(160),
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_video_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"frame_asset_id" uuid NOT NULL,
	"media_file_id" varchar(200) NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_user_id" uuid,
	"approved_by_name" varchar(160),
	"frame_synced_at" timestamp with time zone,
	"frame_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_video_approvals_version_unique" UNIQUE("frame_asset_id","media_file_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_video_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"frame_asset_id" uuid NOT NULL,
	"media_file_id" varchar(200) NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"timecode_ms" integer,
	"body" text NOT NULL,
	"parent_id" uuid,
	"author_user_id" uuid,
	"author_name" varchar(160),
	"author_kind" varchar(16) DEFAULT 'client' NOT NULL,
	"source" varchar(16) DEFAULT 'portal' NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"submission_id" uuid,
	"sync_status" varchar(16) DEFAULT 'none' NOT NULL,
	"sync_attempts" integer DEFAULT 0 NOT NULL,
	"sync_error" text,
	"synced_at" timestamp with time zone,
	"frame_comment_id" varchar(200),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "portal_video_comments_frame_unique" UNIQUE("frame_comment_id")
);
--> statement-breakpoint
ALTER TABLE "frame_assets" ADD COLUMN IF NOT EXISTS "frame_rate" real;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_feedback_submissions" ADD CONSTRAINT "portal_feedback_submissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_feedback_submissions" ADD CONSTRAINT "portal_feedback_submissions_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_feedback_submissions" ADD CONSTRAINT "portal_feedback_submissions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_video_approvals" ADD CONSTRAINT "portal_video_approvals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_video_approvals" ADD CONSTRAINT "portal_video_approvals_frame_asset_id_frame_assets_id_fk" FOREIGN KEY ("frame_asset_id") REFERENCES "public"."frame_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_video_approvals" ADD CONSTRAINT "portal_video_approvals_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_video_comments" ADD CONSTRAINT "portal_video_comments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_video_comments" ADD CONSTRAINT "portal_video_comments_frame_asset_id_frame_assets_id_fk" FOREIGN KEY ("frame_asset_id") REFERENCES "public"."frame_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_video_comments" ADD CONSTRAINT "portal_video_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_feedback_submissions_client_idx" ON "portal_feedback_submissions" USING btree ("client_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_video_approvals_client_idx" ON "portal_video_approvals" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_video_comments_asset_idx" ON "portal_video_comments" USING btree ("frame_asset_id","media_file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_video_comments_client_idx" ON "portal_video_comments" USING btree ("client_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_video_comments_sync_idx" ON "portal_video_comments" USING btree ("sync_status");
