ALTER TABLE "sales_research" ADD COLUMN "city" varchar(160);--> statement-breakpoint
ALTER TABLE "sales_research" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "sales_research" ADD COLUMN "contact_name" varchar(160);--> statement-breakpoint
ALTER TABLE "sales_research" ADD COLUMN "meeting_date" varchar(40);--> statement-breakpoint
ALTER TABLE "sales_research" ADD COLUMN "primary_goal" varchar(60);--> statement-breakpoint
ALTER TABLE "sales_research" ADD COLUMN "goals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_research" ADD COLUMN "result_versions" jsonb DEFAULT '[]'::jsonb NOT NULL;