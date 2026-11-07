CREATE TABLE "monthly_report_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"version_number" integer,
	"resolved_in_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_report_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" varchar(24) DEFAULT 'team' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"last_reminded_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	CONSTRAINT "monthly_report_reads_unique" UNIQUE("report_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "monthly_report_versions" ADD COLUMN "kind" varchar(16) DEFAULT 'publicatie' NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_report_feedback" ADD CONSTRAINT "monthly_report_feedback_report_id_client_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."client_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_feedback" ADD CONSTRAINT "monthly_report_feedback_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_reads" ADD CONSTRAINT "monthly_report_reads_report_id_client_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."client_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_reads" ADD CONSTRAINT "monthly_report_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monthly_report_feedback_report_idx" ON "monthly_report_feedback" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "monthly_report_reads_user_idx" ON "monthly_report_reads" USING btree ("user_id","read_at");