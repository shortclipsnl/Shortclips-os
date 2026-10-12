ALTER TABLE "users" ADD COLUMN "is_staff" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "leave_hours_total" integer DEFAULT 128 NOT NULL;