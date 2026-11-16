-- Contentadvies (Contentgeheugen): voortgang en leerlus per advies. Idempotent (IF NOT EXISTS),
-- zodat de migratie veilig is bij parallelle branches.
CREATE TABLE IF NOT EXISTS "content_advice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"key" varchar(200) NOT NULL,
	"section" varchar(10) NOT NULL,
	"title" varchar(200) NOT NULL,
	"item" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'nog_toepassen' NOT NULL,
	"measure_from" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" jsonb,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by_id" uuid,
	"closed_reason" varchar(12),
	"closed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_advice" ADD CONSTRAINT "content_advice_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_advice" ADD CONSTRAINT "content_advice_status_changed_by_id_users_id_fk" FOREIGN KEY ("status_changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_advice_open_unique" ON "content_advice" USING btree ("client_id","key") WHERE "content_advice"."status" in ('nog_toepassen','ingepland','uitgevoerd','resultaat');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_advice_client_idx" ON "content_advice" USING btree ("client_id","status");
