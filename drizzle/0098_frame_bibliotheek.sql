CREATE TABLE "frame_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"frame_project_id" varchar(200) NOT NULL,
	"frame_file_id" varchar(200) NOT NULL,
	"media_file_id" varchar(200) NOT NULL,
	"name" varchar(400) NOT NULL,
	"session_folder_id" varchar(200),
	"session_name" varchar(240),
	"session_view_url" text,
	"session_created_at" timestamp with time zone,
	"session_production_day_id" uuid,
	"subfolder_name" varchar(240),
	"view_url" text,
	"duration_seconds" integer,
	"comment_count" integer,
	"version_count" integer DEFAULT 1 NOT NULL,
	"thumbnail_url" text,
	"frame_created_at" timestamp with time zone,
	"frame_updated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "frame_assets_file_unique" UNIQUE("frame_file_id")
);
--> statement-breakpoint
ALTER TABLE "frame_assets" ADD CONSTRAINT "frame_assets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_assets" ADD CONSTRAINT "frame_assets_session_production_day_id_production_days_id_fk" FOREIGN KEY ("session_production_day_id") REFERENCES "public"."production_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "frame_assets_client_idx" ON "frame_assets" USING btree ("client_id","session_folder_id");