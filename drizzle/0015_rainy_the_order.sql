CREATE TABLE "company_finance_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" varchar(7) NOT NULL,
	"revenue_target" numeric(12, 2) DEFAULT '0' NOT NULL,
	"freelance_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"staff_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"other_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_finance_months_unique" UNIQUE("period")
);
--> statement-breakpoint
CREATE TABLE "fixed_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(40) DEFAULT 'overig' NOT NULL,
	"name" varchar(160) NOT NULL,
	"monthly_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sales_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" varchar(200) NOT NULL,
	"contact_name" varchar(160),
	"expected_monthly" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_value" numeric(12, 2) DEFAULT '0' NOT NULL,
	"start_on" date,
	"status" varchar(24) DEFAULT 'lead' NOT NULL,
	"note" text,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "company_finance_months" ADD CONSTRAINT "company_finance_months_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;