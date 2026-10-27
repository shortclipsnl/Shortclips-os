ALTER TABLE "script_review_versions" ALTER COLUMN "data_base64" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "script_review_versions" ADD COLUMN "storage_path" text;