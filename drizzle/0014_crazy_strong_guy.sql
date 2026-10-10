CREATE TABLE "editor_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rate_per_video" numeric(10, 2) DEFAULT '0' NOT NULL,
	"capacity_per_week" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editor_rates_user_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "editor_rates" ADD CONSTRAINT "editor_rates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;