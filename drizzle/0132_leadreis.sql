-- Leadreis: onboarding-checklist per lead (8 fases) en centrale standaardberichten/links.
-- Idempotent (IF NOT EXISTS), zodat de migratie veilig is bij parallelle branches.
CREATE TABLE IF NOT EXISTS "lead_journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"phases" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"messages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journey_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(60) NOT NULL,
	"kind" varchar(12) DEFAULT 'message' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_journeys" ADD CONSTRAINT "lead_journeys_lead_id_sales_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."sales_leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_journeys" ADD CONSTRAINT "lead_journeys_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_templates" ADD CONSTRAINT "journey_templates_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_journeys_lead_unique" ON "lead_journeys" USING btree ("lead_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journey_templates_key_unique" ON "journey_templates" USING btree ("key");
