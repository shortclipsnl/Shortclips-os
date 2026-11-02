CREATE TABLE "shoot_script_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_day_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'suggestie' NOT NULL,
	"confidence" varchar(8) DEFAULT 'laag' NOT NULL,
	"file_external_id" varchar(240) NOT NULL,
	"file_name" varchar(400) NOT NULL,
	"file_path" text,
	"match_reason" text,
	"content_hash" varchar(64),
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shoot_script_sources_day_unique" UNIQUE("production_day_id")
);
--> statement-breakpoint
ALTER TABLE "shoot_script_sources" ADD CONSTRAINT "shoot_script_sources_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_script_sources" ADD CONSTRAINT "shoot_script_sources_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_script_sources" ADD CONSTRAINT "shoot_script_sources_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shoot_script_sources_client_idx" ON "shoot_script_sources" USING btree ("client_id","status");