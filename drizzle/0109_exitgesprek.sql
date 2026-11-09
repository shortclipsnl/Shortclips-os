CREATE TABLE "client_exit_interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"interview_date" date,
	"conducted_by_id" uuid,
	"end_date" date,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score_results" smallint,
	"score_collaboration" smallint,
	"score_value" smallint,
	"primary_reason" varchar(32),
	"secondary_reason" varchar(32),
	"other_reason" varchar(240),
	"quote" text,
	"interpretation" text,
	"cause" varchar(12),
	"preventable" varchar(12),
	"lesson" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"future_possible" varchar(12),
	"follow_up_on" date,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_exit_interviews" ADD CONSTRAINT "client_exit_interviews_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_exit_interviews" ADD CONSTRAINT "client_exit_interviews_conducted_by_id_users_id_fk" FOREIGN KEY ("conducted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_exit_interviews" ADD CONSTRAINT "client_exit_interviews_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_exit_interviews" ADD CONSTRAINT "client_exit_interviews_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_exit_interviews_client_uq" ON "client_exit_interviews" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_exit_interviews_reason_idx" ON "client_exit_interviews" USING btree ("primary_reason");