ALTER TABLE "video_analyses" ADD COLUMN "manual_hook_end_ms" integer;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD COLUMN "manual_cta_start_ms" integer;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD COLUMN "sections_corrected_by_id" uuid;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_sections_corrected_by_id_users_id_fk" FOREIGN KEY ("sections_corrected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;