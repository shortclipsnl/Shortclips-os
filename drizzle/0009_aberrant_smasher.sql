ALTER TABLE "clients" ADD COLUMN "edit_cost_per_video" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "contract_months" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "ended_on" date;