ALTER TABLE "production_days" ADD COLUMN "phase" varchar(24) DEFAULT 'nieuw' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_days" ADD COLUMN "phase_entered_on" date;