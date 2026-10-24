ALTER TABLE "sales_leads" ADD COLUMN "external_id" varchar(400);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_external_unique" UNIQUE("external_id");