ALTER TABLE "content_calendar" ADD COLUMN "client_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content_calendar" ADD COLUMN "client_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_calendar" ADD COLUMN "client_approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "content_calendar" ADD CONSTRAINT "content_calendar_client_approved_by_id_users_id_fk" FOREIGN KEY ("client_approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "content_calendar" SET "client_approved" = true WHERE "status" IN ('ready','scheduled','published');
