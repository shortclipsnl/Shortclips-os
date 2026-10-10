ALTER TABLE "company_finance_months" ADD COLUMN "book_revenue" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_finance_months" ADD COLUMN "book_cost" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_finance_months" ADD COLUMN "book_finance_income" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_finance_months" ADD COLUMN "book_source" varchar(24);--> statement-breakpoint
ALTER TABLE "company_finance_months" ADD COLUMN "book_imported_at" timestamp with time zone;