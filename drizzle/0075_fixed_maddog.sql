ALTER TABLE "goals" ADD COLUMN "achieved_manually" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "achieved_at" timestamp with time zone;