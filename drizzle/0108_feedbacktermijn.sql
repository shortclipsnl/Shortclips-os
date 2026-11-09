CREATE TABLE "client_feedback_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"round_number" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"started_on" date NOT NULL,
	"term_days" integer DEFAULT 3 NOT NULL,
	"due_on" date NOT NULL,
	"revision_mark" integer DEFAULT 0 NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_status" varchar(32),
	"reminder_at" timestamp with time zone,
	"reminder_task_id" uuid,
	"reminder_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_feedback_rounds_number_unique" UNIQUE("deliverable_id","round_number")
);
--> statement-breakpoint
ALTER TABLE "client_feedback_rounds" ADD CONSTRAINT "client_feedback_rounds_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_feedback_rounds" ADD CONSTRAINT "client_feedback_rounds_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_feedback_rounds" ADD CONSTRAINT "client_feedback_rounds_reminder_task_id_tasks_id_fk" FOREIGN KEY ("reminder_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_feedback_rounds_open_idx" ON "client_feedback_rounds" USING btree ("ended_at","deliverable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_feedback_rounds_one_open" ON "client_feedback_rounds" USING btree ("deliverable_id") WHERE "client_feedback_rounds"."ended_at" is null;