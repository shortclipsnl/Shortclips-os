CREATE TABLE "client_research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" varchar(16) DEFAULT 'nulmeting' NOT NULL,
	"status" varchar(16) DEFAULT 'bezig' NOT NULL,
	"phase" varchar(32) DEFAULT 'intern' NOT NULL,
	"internal" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"briefing_company" text,
	"briefing_social" text,
	"dossier" jsonb,
	"baseline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_basis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"corrections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"additions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"error_message" text,
	"triggered_by_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"next_check_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "client_research_runs" ADD CONSTRAINT "client_research_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_research_runs" ADD CONSTRAINT "client_research_runs_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_research_runs" ADD CONSTRAINT "client_research_runs_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_research_runs_client_idx" ON "client_research_runs" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "client_research_runs_status_idx" ON "client_research_runs" USING btree ("status");
