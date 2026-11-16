-- Editor Meetings: eigen bespreekpunten van de editor ("Wat wil ik bespreken?").
-- Idempotent (IF NOT EXISTS), zodat de migratie veilig is bij parallelle branches.
CREATE TABLE IF NOT EXISTS "editor_meeting_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"outcome" varchar(16),
	"meeting_id" uuid,
	"handled_at" timestamp with time zone,
	"handled_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_items" ADD CONSTRAINT "editor_meeting_items_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_items" ADD CONSTRAINT "editor_meeting_items_meeting_id_editor_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."editor_meetings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_items" ADD CONSTRAINT "editor_meeting_items_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_meeting_items_editor_idx" ON "editor_meeting_items" USING btree ("editor_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_meeting_items_meeting_idx" ON "editor_meeting_items" USING btree ("meeting_id");
