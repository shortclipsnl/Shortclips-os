ALTER TABLE "clients" ADD COLUMN "we_handle_posting" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Behoud het bestaande gedrag: deze klanten posten we niet (was hardcoded).
UPDATE "clients" SET "we_handle_posting" = false
WHERE lower(regexp_replace("name", '[^A-Za-z0-9]', '', 'g')) IN ('365werk','autofotostudio','bedrijfskledingonline','bmtek');
