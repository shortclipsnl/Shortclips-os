CREATE TABLE "client_finance_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"period" varchar(7) NOT NULL,
	"revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"extra_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"edit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"shoot_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"strategy_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"other_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"source" varchar(16) DEFAULT 'auto' NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_finance_months_unique" UNIQUE("client_id","period")
);
--> statement-breakpoint
ALTER TABLE "client_finance_months" ADD CONSTRAINT "client_finance_months_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_finance_months" ADD CONSTRAINT "client_finance_months_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_finance_months_period_idx" ON "client_finance_months" USING btree ("period");