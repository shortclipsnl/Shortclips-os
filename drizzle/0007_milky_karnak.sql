CREATE TABLE "sales_research" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"company_name" varchar(200) NOT NULL,
	"website" varchar(300),
	"instagram" varchar(300),
	"tiktok" varchar(300),
	"linkedin" varchar(300),
	"facebook" varchar(300),
	"youtube" varchar(300),
	"branche" varchar(160),
	"extra" text,
	"status" varchar(24) DEFAULT 'concept' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sales_research" ADD CONSTRAINT "sales_research_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_research" ADD CONSTRAINT "sales_research_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_research_client_idx" ON "sales_research" USING btree ("client_id");