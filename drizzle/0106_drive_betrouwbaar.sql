ALTER TABLE "drive_mappings" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drive_mappings" ADD COLUMN "lease_owner" varchar(64);--> statement-breakpoint
ALTER TABLE "drive_mappings" ADD COLUMN "last_full_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drive_mappings" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "drive_mappings" ADD COLUMN "last_error_at" timestamp with time zone;