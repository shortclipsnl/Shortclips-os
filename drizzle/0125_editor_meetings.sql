-- Editor Meetings: maandelijks gesprek per editor met de verantwoordelijke content creator.
-- Idempotent (IF NOT EXISTS), zodat de migratie veilig is bij parallelle branches.
CREATE TABLE IF NOT EXISTS "editor_meeting_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"set_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editor_meeting_owners_editor_unique" UNIQUE("editor_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "editor_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"owner_id" uuid,
	"period" varchar(7) NOT NULL,
	"scheduled_at" timestamp with time zone,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"location" varchar(160),
	"meeting_url" text,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'gepland' NOT NULL,
	"report_status" varchar(16) DEFAULT 'geen' NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"internal_notes" text,
	"published_at" timestamp with time zone,
	"published_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editor_meetings_editor_period_unique" UNIQUE("editor_id","period")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "editor_meeting_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"editor_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"theme" varchar(24) DEFAULT 'overig' NOT NULL,
	"body" text NOT NULL,
	"example" text,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "editor_meeting_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"editor_id" uuid NOT NULL,
	"body" text NOT NULL,
	"owner_type" varchar(16) DEFAULT 'editor' NOT NULL,
	"assignee_id" uuid,
	"due_on" date,
	"task_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_owners" ADD CONSTRAINT "editor_meeting_owners_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_owners" ADD CONSTRAINT "editor_meeting_owners_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_owners" ADD CONSTRAINT "editor_meeting_owners_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meetings" ADD CONSTRAINT "editor_meetings_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meetings" ADD CONSTRAINT "editor_meetings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meetings" ADD CONSTRAINT "editor_meetings_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meetings" ADD CONSTRAINT "editor_meetings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_points" ADD CONSTRAINT "editor_meeting_points_meeting_id_editor_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."editor_meetings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_points" ADD CONSTRAINT "editor_meeting_points_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_actions" ADD CONSTRAINT "editor_meeting_actions_meeting_id_editor_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."editor_meetings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_actions" ADD CONSTRAINT "editor_meeting_actions_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_actions" ADD CONSTRAINT "editor_meeting_actions_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_meeting_actions" ADD CONSTRAINT "editor_meeting_actions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_meetings_owner_idx" ON "editor_meetings" USING btree ("owner_id","period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_meetings_period_idx" ON "editor_meetings" USING btree ("period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_meeting_points_meeting_idx" ON "editor_meeting_points" USING btree ("meeting_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_meeting_points_editor_idx" ON "editor_meeting_points" USING btree ("editor_id","kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_meeting_actions_meeting_idx" ON "editor_meeting_actions" USING btree ("meeting_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_meeting_actions_editor_idx" ON "editor_meeting_actions" USING btree ("editor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_meeting_actions_task_idx" ON "editor_meeting_actions" USING btree ("task_id");
