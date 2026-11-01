CREATE TYPE "public"."caption_item_status" AS ENUM('gegenereerd', 'bewerkt');--> statement-breakpoint
CREATE TYPE "public"."caption_set_status" AS ENUM('bezig', 'klaar_controle', 'gedeeltelijk', 'bijgewerkt_script', 'gecontroleerd', 'mislukt');--> statement-breakpoint
CREATE TABLE "caption_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caption_set_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"short_title" varchar(300) DEFAULT '' NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "caption_item_status" DEFAULT 'gegenereerd' NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"stale_from_new_version" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caption_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_day_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "caption_set_status" DEFAULT 'bezig' NOT NULL,
	"source_review_version_id" uuid,
	"source_hash" varchar(64),
	"generated_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"error_message" text,
	"checked_by_id" uuid,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "caption_sets_production_day_unique" UNIQUE("production_day_id")
);
--> statement-breakpoint
ALTER TABLE "caption_items" ADD CONSTRAINT "caption_items_caption_set_id_caption_sets_id_fk" FOREIGN KEY ("caption_set_id") REFERENCES "public"."caption_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caption_sets" ADD CONSTRAINT "caption_sets_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caption_sets" ADD CONSTRAINT "caption_sets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caption_sets" ADD CONSTRAINT "caption_sets_checked_by_id_users_id_fk" FOREIGN KEY ("checked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "caption_items_set_idx" ON "caption_items" USING btree ("caption_set_id","position");--> statement-breakpoint
CREATE INDEX "caption_sets_client_idx" ON "caption_sets" USING btree ("client_id","status");