CREATE TYPE "public"."transfer_status" AS ENUM('uploading', 'available', 'expired', 'deleted');--> statement-breakpoint
CREATE TABLE "transfer_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"file_name" varchar(400) NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"content_type" varchar(160),
	"r2_key" text NOT NULL,
	"upload_id" text,
	"status" varchar(16) DEFAULT 'uploading' NOT NULL,
	"part_size" bigint DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(48) NOT NULL,
	"owner_id" uuid,
	"title" varchar(240) DEFAULT 'Transfer' NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"status" "transfer_status" DEFAULT 'uploading' NOT NULL,
	"completed_at" timestamp with time zone,
	"download_expires_on" timestamp with time zone,
	"storage_expires_on" timestamp with time zone,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transfers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "transfer_files" ADD CONSTRAINT "transfer_files_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_files_transfer_idx" ON "transfer_files" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "transfers_owner_idx" ON "transfers" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "transfers_status_idx" ON "transfers" USING btree ("status");