CREATE TABLE "ad_edit_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"preview_store" varchar(20),
	"preview_path" text,
	"qc" jsonb,
	"explanation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_edit_versions" ADD CONSTRAINT "ad_edit_versions_project_id_ad_edit_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ad_edit_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_edit_versions_project_idx" ON "ad_edit_versions" USING btree ("project_id","version");