-- Monday volledig verwijderen uit het portaal (handgeschreven: data behouden).
-- 1) Mapping-tabel hernoemen (nu Google-Agenda-koppeling) — data blijft.
ALTER TABLE "monday_mappings" RENAME TO "calendar_mappings";--> statement-breakpoint
ALTER INDEX "monday_mappings_entity_idx" RENAME TO "calendar_mappings_entity_idx";--> statement-breakpoint
ALTER INDEX "monday_mappings_board_idx" RENAME TO "calendar_mappings_board_idx";--> statement-breakpoint
ALTER TABLE "calendar_mappings" RENAME CONSTRAINT "monday_mappings_item_unique" TO "calendar_mappings_item_unique";--> statement-breakpoint

-- 2) Datakolommen hernoemen — data blijft.
ALTER TABLE "clients" RENAME COLUMN "net_monthly_monday" TO "net_monthly";--> statement-breakpoint
ALTER TABLE "sales_leads" RENAME COLUMN "monday_status" TO "external_status";--> statement-breakpoint

-- 3) Enum integration_provider: 'monday' eruit, 'system' erbij (type herbouwen).
--    Dode Monday-koppelingen verwijderen; interne jobhistorie 'monday' -> 'system'.
DELETE FROM "client_integrations" WHERE "provider" = 'monday';--> statement-breakpoint
DELETE FROM "integration_connections" WHERE "provider" = 'monday';--> statement-breakpoint
DELETE FROM "integration_events" WHERE "provider" = 'monday';--> statement-breakpoint
CREATE TYPE "public"."integration_provider_new" AS ENUM('frameio', 'google_drive', 'google_calendar', 'gmail', 'ayrshare', 'metricool', 'system');--> statement-breakpoint
ALTER TABLE "integration_connections" ALTER COLUMN "provider" TYPE "public"."integration_provider_new" USING ("provider"::text::"public"."integration_provider_new");--> statement-breakpoint
ALTER TABLE "integration_events" ALTER COLUMN "provider" TYPE "public"."integration_provider_new" USING ("provider"::text::"public"."integration_provider_new");--> statement-breakpoint
ALTER TABLE "client_integrations" ALTER COLUMN "provider" TYPE "public"."integration_provider_new" USING ("provider"::text::"public"."integration_provider_new");--> statement-breakpoint
ALTER TABLE "sync_jobs" ALTER COLUMN "provider" TYPE "public"."integration_provider_new" USING ((CASE WHEN "provider"::text = 'monday' THEN 'system' ELSE "provider"::text END)::"public"."integration_provider_new");--> statement-breakpoint
DROP TYPE "public"."integration_provider";--> statement-breakpoint
ALTER TYPE "public"."integration_provider_new" RENAME TO "integration_provider";--> statement-breakpoint

-- 4) Enum file_source: 'monday' eruit (bestanden met bron 'monday' -> 'google_drive').
UPDATE "files" SET "source" = 'google_drive' WHERE "source"::text = 'monday';--> statement-breakpoint
CREATE TYPE "public"."file_source_new" AS ENUM('shortclips_os', 'google_drive', 'frameio', 'upload');--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "source" TYPE "public"."file_source_new" USING ("source"::text::"public"."file_source_new");--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "source" SET DEFAULT 'google_drive';--> statement-breakpoint
DROP TYPE "public"."file_source";--> statement-breakpoint
ALTER TYPE "public"."file_source_new" RENAME TO "file_source";
