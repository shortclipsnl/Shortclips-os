ALTER TYPE "public"."content_idea_status" ADD VALUE 'gebruikt';--> statement-breakpoint
CREATE TABLE "content_competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"naam" varchar(160) NOT NULL,
	"url" text,
	"tiktok" varchar(160),
	"instagram" varchar(160),
	"youtube" varchar(160),
	"notitie" text,
	"bron" varchar(12) DEFAULT 'team' NOT NULL,
	"actief" boolean DEFAULT true NOT NULL,
	"laatste_observatie" text,
	"laatste_observatie_op" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "onderbouwing" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "opportunity" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "opportunity_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "middenstuk" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "middenstuk_richting" text;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "cta_commercieel" text;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "cta_interactie" text;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "invalshoek" text;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "herhaal_reden" text;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "forwarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "forwarded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "script_link" text;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "resultaat" jsonb;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "keuring" jsonb;--> statement-breakpoint
ALTER TABLE "content_research_profiles" ADD COLUMN "style" jsonb;--> statement-breakpoint
ALTER TABLE "content_research_profiles" ADD COLUMN "style_sources" jsonb;--> statement-breakpoint
ALTER TABLE "content_research_profiles" ADD COLUMN "style_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "content_research_profiles" ADD COLUMN "style_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_research_profiles" ADD COLUMN "style_notes" text;--> statement-breakpoint
ALTER TABLE "content_research_runs" ADD COLUMN "data_basis" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_research_runs" ADD COLUMN "briefing" text;--> statement-breakpoint
ALTER TABLE "content_research_runs" ADD COLUMN "kandidaten" jsonb;--> statement-breakpoint
ALTER TABLE "content_research_runs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_research_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_competitors" ADD CONSTRAINT "content_competitors_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_competitors" ADD CONSTRAINT "content_competitors_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_competitors_client_idx" ON "content_competitors" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_forwarded_by_id_users_id_fk" FOREIGN KEY ("forwarded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;