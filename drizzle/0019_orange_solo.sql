ALTER TABLE "sales_leads" ADD COLUMN "source" varchar(40);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "phone" varchar(40);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "email" varchar(160);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "website" varchar(200);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "budget" varchar(120);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "first_contact_on" date;--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "follow_up_on" date;--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "lead_class" varchar(8);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "lead_score" integer;--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "audit_outcome" varchar(80);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "audit_next_step" varchar(120);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "sales_brief" text;--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "segment" varchar(24);--> statement-breakpoint
ALTER TABLE "sales_leads" ADD COLUMN "monday_status" varchar(60);--> statement-breakpoint
CREATE INDEX "sales_leads_status_idx" ON "sales_leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sales_leads_followup_idx" ON "sales_leads" USING btree ("follow_up_on");