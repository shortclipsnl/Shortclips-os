ALTER TABLE "quote_events" ADD COLUMN "external_id" varchar(80);--> statement-breakpoint
ALTER TABLE "quote_events" ADD COLUMN "actor" varchar(320);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "pandadoc_status" varchar(40);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "pandadoc_modified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "pdf_for_status" varchar(40);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "service_type" varchar(60);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "amount_incl_vat" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "amount_source" varchar(20);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "sender_email" varchar(320);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "sender_name" varchar(160);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "lead_match" varchar(20);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "sync_error" text;--> statement-breakpoint
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_external_unique" UNIQUE("external_id");