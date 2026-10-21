ALTER TABLE "video_analyses" ADD COLUMN "media_store" varchar(20);--> statement-breakpoint
ALTER TABLE "video_analyses" ADD COLUMN "thumbnail_data" text;--> statement-breakpoint
ALTER TABLE "video_shots" ADD COLUMN "thumbnail_data" text;