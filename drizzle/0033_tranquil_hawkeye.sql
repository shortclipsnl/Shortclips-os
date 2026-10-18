ALTER TABLE "production_days" ADD COLUMN "editor_id" uuid;--> statement-breakpoint
ALTER TABLE "production_days" ADD COLUMN "edit_status" varchar(24) DEFAULT 'te_plannen' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_days" ADD COLUMN "planned_shorts" integer;--> statement-breakpoint
ALTER TABLE "production_days" ADD COLUMN "footage_url" text;--> statement-breakpoint
ALTER TABLE "production_days" ADD COLUMN "script_url" text;--> statement-breakpoint
ALTER TABLE "production_days" ADD CONSTRAINT "production_days_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_days_editor_idx" ON "production_days" USING btree ("editor_id");