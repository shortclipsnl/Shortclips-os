CREATE TYPE "public"."leave_status" AS ENUM('requested', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"kind" varchar(32) DEFAULT 'vakantie' NOT NULL,
	"status" "leave_status" DEFAULT 'requested' NOT NULL,
	"note" text,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"kind" varchar(16) DEFAULT 'agenda' NOT NULL,
	"body" text NOT NULL,
	"assignee_id" uuid,
	"due_on" date,
	"task_id" uuid,
	"is_done" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"location" varchar(160),
	"participant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_items" ADD CONSTRAINT "meeting_items_meeting_id_team_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."team_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_items" ADD CONSTRAINT "meeting_items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_items" ADD CONSTRAINT "meeting_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_items" ADD CONSTRAINT "meeting_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_meetings" ADD CONSTRAINT "team_meetings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_user_idx" ON "leave_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "leave_requests_range_idx" ON "leave_requests" USING btree ("start_on","end_on");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meeting_items_meeting_idx" ON "meeting_items" USING btree ("meeting_id","kind");--> statement-breakpoint
CREATE INDEX "team_meetings_date_idx" ON "team_meetings" USING btree ("scheduled_at");