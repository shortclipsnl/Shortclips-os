ALTER TABLE "ad_edit_projects" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_edit_projects" ADD COLUMN "production_day_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_edit_projects" ADD COLUMN "script_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_edit_projects" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "ad_edit_projects" ADD CONSTRAINT "ad_edit_projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_edit_projects" ADD CONSTRAINT "ad_edit_projects_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_edit_projects" ADD CONSTRAINT "ad_edit_projects_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;