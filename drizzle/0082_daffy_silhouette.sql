CREATE TYPE "public"."briefing_set_status" AS ENUM('bezig', 'klaar', 'bijgewerkt_script', 'mislukt');--> statement-breakpoint
CREATE TYPE "public"."content_idea_category" AS ENUM('humor', 'educatief', 'teamcontent', 'trends', 'productcontent', 'seizoen', 'overig');--> statement-breakpoint
CREATE TYPE "public"."content_idea_effort" AS ENUM('eenvoudig', 'gemiddeld', 'uitgebreid');--> statement-breakpoint
CREATE TYPE "public"."content_idea_status" AS ENUM('nieuw', 'favoriet', 'opgeslagen', 'afgewezen', 'gearchiveerd', 'doorgestuurd');--> statement-breakpoint
CREATE TYPE "public"."content_research_run_status" AS ENUM('bezig', 'klaar', 'mislukt');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('uploading', 'available', 'expired', 'deleted');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'operational_manager';--> statement-breakpoint
CREATE TABLE "briefing_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_day_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "briefing_set_status" DEFAULT 'bezig' NOT NULL,
	"source_review_version_id" uuid,
	"source_hash" varchar(64),
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "briefing_sets_production_day_unique" UNIQUE("production_day_id")
);
--> statement-breakpoint
CREATE TABLE "transfer_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"file_name" varchar(400) NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"content_type" varchar(160),
	"r2_key" text NOT NULL,
	"upload_id" text,
	"status" varchar(16) DEFAULT 'uploading' NOT NULL,
	"part_size" bigint DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(48) NOT NULL,
	"owner_id" uuid,
	"title" varchar(240) DEFAULT 'Transfer' NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"status" "transfer_status" DEFAULT 'uploading' NOT NULL,
	"completed_at" timestamp with time zone,
	"download_expires_on" timestamp with time zone,
	"storage_expires_on" timestamp with time zone,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transfers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "content_chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"title" varchar(200) DEFAULT 'Nieuw gesprek' NOT NULL,
	"pinned_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(12) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"run_id" uuid,
	"titel" varchar(240) NOT NULL,
	"concept" text DEFAULT '' NOT NULL,
	"hooks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"waarom_werkt" text,
	"inspiratie_url" text,
	"inspiratie_label" varchar(240),
	"categorie" "content_idea_category" DEFAULT 'overig' NOT NULL,
	"uitvoerbaarheid" "content_idea_effort" DEFAULT 'gemiddeld' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"score_reason" text,
	"status" "content_idea_status" DEFAULT 'nieuw' NOT NULL,
	"rejection_reason" text,
	"forwarded_script_id" uuid,
	"dedupe_hash" varchar(64),
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_research_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auto_summary" text,
	"manual_notes" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_research_profiles_client_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "content_research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "content_research_run_status" DEFAULT 'bezig' NOT NULL,
	"phase" varchar(20) DEFAULT 'zoeken' NOT NULL,
	"summary" text,
	"trends" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ideas_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"triggered_by_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "briefing_sets" ADD CONSTRAINT "briefing_sets_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_sets" ADD CONSTRAINT "briefing_sets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_files" ADD CONSTRAINT "transfer_files_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chat_conversations" ADD CONSTRAINT "content_chat_conversations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chat_conversations" ADD CONSTRAINT "content_chat_conversations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chat_messages" ADD CONSTRAINT "content_chat_messages_conversation_id_content_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."content_chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_run_id_content_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."content_research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_forwarded_script_id_scripts_id_fk" FOREIGN KEY ("forwarded_script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_research_profiles" ADD CONSTRAINT "content_research_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_research_profiles" ADD CONSTRAINT "content_research_profiles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_research_runs" ADD CONSTRAINT "content_research_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_research_runs" ADD CONSTRAINT "content_research_runs_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefing_sets_client_idx" ON "briefing_sets" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "transfer_files_transfer_idx" ON "transfer_files" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "transfers_owner_idx" ON "transfers" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "transfers_status_idx" ON "transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_chat_conv_client_idx" ON "content_chat_conversations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "content_chat_msg_conv_idx" ON "content_chat_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "content_ideas_client_idx" ON "content_ideas" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "content_ideas_run_idx" ON "content_ideas" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "content_research_runs_client_idx" ON "content_research_runs" USING btree ("client_id","status");