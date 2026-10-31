ALTER TABLE "edit_project_files" ALTER COLUMN "data_base64" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "edit_project_files" ADD COLUMN "storage_path" text;