CREATE TABLE "draaiboek_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draaiboek_id" uuid NOT NULL,
	"video_key" varchar(40) NOT NULL,
	"kind" varchar(16) DEFAULT 'notitie' NOT NULL,
	"text" text,
	"summary" text,
	"audio" "bytea",
	"audio_mime" varchar(60),
	"duration_sec" integer,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "draaiboeken" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_day_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'concept' NOT NULL,
	"source_hash" varchar(64),
	"source_file_name" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone,
	"sent_to_id" uuid,
	"sent_by_id" uuid,
	"sent_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"finish_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "draaiboeken_production_day_unique" UNIQUE("production_day_id")
);
--> statement-breakpoint
ALTER TABLE "draaiboek_notes" ADD CONSTRAINT "draaiboek_notes_draaiboek_id_draaiboeken_id_fk" FOREIGN KEY ("draaiboek_id") REFERENCES "public"."draaiboeken"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draaiboek_notes" ADD CONSTRAINT "draaiboek_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draaiboeken" ADD CONSTRAINT "draaiboeken_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draaiboeken" ADD CONSTRAINT "draaiboeken_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draaiboeken" ADD CONSTRAINT "draaiboeken_sent_to_id_users_id_fk" FOREIGN KEY ("sent_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draaiboeken" ADD CONSTRAINT "draaiboeken_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draaiboek_notes_draaiboek_idx" ON "draaiboek_notes" USING btree ("draaiboek_id","video_key");--> statement-breakpoint
CREATE INDEX "draaiboeken_sent_to_idx" ON "draaiboeken" USING btree ("sent_to_id","status");