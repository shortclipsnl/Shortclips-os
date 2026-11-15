-- Kwartaalrapportages: eigen tabellen naast de maandrapportages. Idempotent
-- (IF NOT EXISTS), zodat de migratie veilig is bij parallelle branches.
CREATE TABLE IF NOT EXISTS "client_quarter_settings" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"mode" varchar(12) DEFAULT 'kalender' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"doelen" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quarterly_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"period_mode" varchar(12) DEFAULT 'kalender' NOT NULL,
	"period_key" varchar(16) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"title" varchar(200) NOT NULL,
	"status" varchar(24) DEFAULT 'gepland' NOT NULL,
	"voorlopig" boolean DEFAULT true NOT NULL,
	"queued" varchar(12),
	"pakket_type" varchar(12) DEFAULT 'onbekend' NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"klant" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"intern" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ontbrekend" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wacht_reden" text,
	"open_feedback" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version_number" integer DEFAULT 0 NOT NULL,
	"published_version" integer,
	"published_at" timestamp with time zone,
	"published_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_version" integer,
	"data_override_at" timestamp with time zone,
	"data_override_by_id" uuid,
	"started_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"lessons_saved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "quarterly_reports_unique" UNIQUE("client_id","period_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quarterly_report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quarterly_report_versions_unique" UNIQUE("report_id","version_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quarterly_report_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"from_status" varchar(24),
	"to_status" varchar(24),
	"by_id" uuid,
	"note" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quarterly_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"period_key" varchar(16) NOT NULL,
	"period_label" varchar(80) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"text" text NOT NULL,
	"zekerheid" varchar(16) DEFAULT 'hypothese' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quarterly_improvements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"period_key" varchar(16) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"titel" varchar(240) NOT NULL,
	"actie" text DEFAULT '' NOT NULL,
	"verantwoordelijke" varchar(120),
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"task_id" uuid,
	"note" text,
	"done_at" timestamp with time zone,
	"done_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_quarter_settings" ADD CONSTRAINT "client_quarter_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_quarter_settings" ADD CONSTRAINT "client_quarter_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_reports" ADD CONSTRAINT "quarterly_reports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_reports" ADD CONSTRAINT "quarterly_reports_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_reports" ADD CONSTRAINT "quarterly_reports_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_reports" ADD CONSTRAINT "quarterly_reports_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_reports" ADD CONSTRAINT "quarterly_reports_data_override_by_id_users_id_fk" FOREIGN KEY ("data_override_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_report_versions" ADD CONSTRAINT "quarterly_report_versions_report_id_quarterly_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."quarterly_reports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_report_versions" ADD CONSTRAINT "quarterly_report_versions_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_report_events" ADD CONSTRAINT "quarterly_report_events_report_id_quarterly_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."quarterly_reports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_report_events" ADD CONSTRAINT "quarterly_report_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_report_events" ADD CONSTRAINT "quarterly_report_events_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_lessons" ADD CONSTRAINT "quarterly_lessons_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_lessons" ADD CONSTRAINT "quarterly_lessons_report_id_quarterly_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."quarterly_reports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_improvements" ADD CONSTRAINT "quarterly_improvements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_improvements" ADD CONSTRAINT "quarterly_improvements_report_id_quarterly_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."quarterly_reports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quarterly_improvements" ADD CONSTRAINT "quarterly_improvements_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quarterly_reports_status_idx" ON "quarterly_reports" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quarterly_reports_period_idx" ON "quarterly_reports" USING btree ("period_end");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quarterly_report_events_report_idx" ON "quarterly_report_events" USING btree ("report_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quarterly_lessons_client_idx" ON "quarterly_lessons" USING btree ("client_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quarterly_improvements_client_idx" ON "quarterly_improvements" USING btree ("client_id","period_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quarterly_improvements_report_idx" ON "quarterly_improvements" USING btree ("report_id");
