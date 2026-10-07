ALTER TABLE "daily_metrics" ADD COLUMN "shares" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "saves" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "watch_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "video_views" integer DEFAULT 0 NOT NULL;