CREATE TYPE "public"."briefing_set_status" AS ENUM('bezig', 'klaar', 'bijgewerkt_script', 'mislukt');--> statement-breakpoint
CREATE TABLE "briefing_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_day_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "briefing_set_status" DEFAULT 'bezig' NOT NULL,
	"source_review_version_id" uuid,
	"source_hash" varchar(64),
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "briefing_sets_production_day_unique" UNIQUE("production_day_id")
);
--> statement-breakpoint
ALTER TABLE "briefing_sets" ADD CONSTRAINT "briefing_sets_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_sets" ADD CONSTRAINT "briefing_sets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefing_sets_client_idx" ON "briefing_sets" USING btree ("client_id","status");