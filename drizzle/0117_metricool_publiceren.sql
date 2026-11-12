ALTER TABLE "clients" ADD COLUMN "metricool_publishing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "metricool_final_confirm" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "client_publication_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content_calendar" ADD COLUMN IF NOT EXISTS "frame_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "publish_mode" varchar(12) DEFAULT 'handmatig' NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "released_by_id" uuid;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "released_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "video_version_id" uuid;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "metricool_post_id" varchar(64);--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "metricool_post_uuid" varchar(64);--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "sync_status" varchar(20) DEFAULT 'niet_verstuurd' NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "sent_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "published_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_released_by_id_users_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publications_item_platform_unique" ON "publications" USING btree ("calendar_item_id","platform") WHERE "publications"."deleted_at" IS NULL AND "publications"."calendar_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "publications_sync_idx" ON "publications" USING btree ("sync_status","next_retry_at");