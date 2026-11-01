CREATE TYPE "public"."monthly_report_status" AS ENUM('gegevens_verzamelen', 'analyse_bezig', 'klaar_voor_controle', 'aanpassing_nodig', 'goedgekeurd', 'gepubliceerd', 'mislukt');--> statement-breakpoint
CREATE TABLE "client_strategy_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"primary_goal" varchar(40),
	"secondary_goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strategy_note" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_strategy_profiles_client_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "monthly_report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "status" "monthly_report_status" DEFAULT 'gegevens_verzamelen' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "analysis" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "aandachtspunten" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "strategische_acties" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "beoordeling" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "kwaliteit" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "ontbrekende_gegevens" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "reviewed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "client_strategy_profiles" ADD CONSTRAINT "client_strategy_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_strategy_profiles" ADD CONSTRAINT "client_strategy_profiles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_versions" ADD CONSTRAINT "monthly_report_versions_report_id_client_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."client_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_versions" ADD CONSTRAINT "monthly_report_versions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monthly_report_versions_report_idx" ON "monthly_report_versions" USING btree ("report_id","version_number");--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_reports_status_idx" ON "client_reports" USING btree ("status");