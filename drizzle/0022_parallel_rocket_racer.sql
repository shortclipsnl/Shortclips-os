ALTER TABLE "deliverables" ADD COLUMN "due_on_source" varchar(8) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "suggested_production_day_id" uuid;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "link_confidence" varchar(8);--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "link_reviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_suggested_production_day_id_production_days_id_fk" FOREIGN KEY ("suggested_production_day_id") REFERENCES "public"."production_days"("id") ON DELETE set null ON UPDATE no action;