ALTER TABLE "production_days" ALTER COLUMN "scripting_status" SET DEFAULT 'concepting';--> statement-breakpoint
UPDATE "production_days" SET "scripting_status" = 'concepting' WHERE "scripting_status" = 'afstemmen';--> statement-breakpoint
UPDATE "production_days" SET "scripting_status" = 'afwachting_klant' WHERE "scripting_status" = 'klaar_shortclips';
