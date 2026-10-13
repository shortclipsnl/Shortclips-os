CREATE TABLE "capacity_params" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(48) NOT NULL,
	"label" varchar(200),
	"value" numeric(14, 4),
	"unit" varchar(80),
	"confidence" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_params_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "capacity_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" varchar(120) NOT NULL,
	"aliases" varchar(300),
	"employment" varchar(16),
	"role" varchar(24),
	"unit" varchar(20) DEFAULT 'niet_gemeten' NOT NULL,
	"workdays_per_week" numeric(4, 1),
	"contract_hours_per_week" numeric(5, 1),
	"productive_hours_per_month" numeric(6, 1),
	"limit_green" numeric(8, 2),
	"limit_orange" numeric(8, 2),
	"limit_max" numeric(8, 2),
	"cost_per_month" numeric(10, 2),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_people_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "capacity_people" ADD CONSTRAINT "capacity_people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;