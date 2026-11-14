-- Klanten die aandacht nodig hebben (Resultatenpagina). Idempotent (IF NOT EXISTS),
-- zodat de migratie veilig is bij parallelle branches en handmatig vooraf toepassen.
CREATE TABLE IF NOT EXISTS "result_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" varchar(12) NOT NULL,
	"level" varchar(8) NOT NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"headline" varchar(200) NOT NULL,
	"analysis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assignee_id" uuid,
	"task_id" uuid,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action_at" timestamp with time zone,
	"action_text" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"resolution_note" text,
	"effect" jsonb,
	"notified_at" timestamp with time zone,
	"notified_level" varchar(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "result_alerts" ADD CONSTRAINT "result_alerts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "result_alerts" ADD CONSTRAINT "result_alerts_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "result_alerts" ADD CONSTRAINT "result_alerts_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "result_alerts_active_unique" ON "result_alerts" USING btree ("client_id","kind") WHERE "result_alerts"."status" in ('open','actie');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "result_alerts_status_idx" ON "result_alerts" USING btree ("status","level");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "result_alerts_client_idx" ON "result_alerts" USING btree ("client_id","first_detected_at");
