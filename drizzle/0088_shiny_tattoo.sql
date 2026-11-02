ALTER TABLE "users" ADD COLUMN "availability_periods" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "content_focus" varchar(16);