-- Contentgeheugen: beoordeling per inzicht voor het klantportaal ("Wat werkt bij jouw bedrijf?").
-- Idempotent (IF NOT EXISTS), zodat de migratie veilig is bij parallelle branches.
CREATE TABLE IF NOT EXISTS "content_insight_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"key" varchar(200) NOT NULL,
	"decision" varchar(10) NOT NULL,
	"client_title" varchar(200),
	"client_text" varchar(600),
	"item" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_insight_reviews" ADD CONSTRAINT "content_insight_reviews_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_insight_reviews" ADD CONSTRAINT "content_insight_reviews_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_insight_reviews_unique" ON "content_insight_reviews" USING btree ("client_id","key");
