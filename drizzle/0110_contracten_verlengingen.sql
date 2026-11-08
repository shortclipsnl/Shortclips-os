ALTER TABLE "contracts" ALTER COLUMN "starts_on" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "videos_per_month" integer;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "duration_months" integer;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "renewal_status" varchar(16) DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "client_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "reminder_days" jsonb;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "end_reason" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "reactivation" varchar(12);--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "owner_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "previous_contract_id" uuid;--> statement-breakpoint
-- De bulkimport van 18 okt 2026 vulde als startdatum de importdatum (20 okt 2026)
-- in, niet de echte startdatum. Die waarde is nooit gecontroleerd en wordt leeg
-- gemaakt, zodat nergens een verzonnen startdatum zichtbaar is.
UPDATE "contracts" SET "starts_on" = NULL WHERE "starts_on" = '2026-10-20' AND "verified_at" IS NULL AND "created_at" < '2026-10-19';
