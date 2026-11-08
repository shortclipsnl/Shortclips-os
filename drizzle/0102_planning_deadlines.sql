CREATE TABLE "planning_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"deadline_on" date NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"started_by_id" uuid,
	"had_client_actions" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_via" varchar(16),
	"completed_by_id" uuid,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "planning_deadlines" ADD CONSTRAINT "planning_deadlines_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_deadlines" ADD CONSTRAINT "planning_deadlines_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_deadlines" ADD CONSTRAINT "planning_deadlines_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planning_deadlines_client_idx" ON "planning_deadlines" USING btree ("client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_deadlines_one_active" ON "planning_deadlines" USING btree ("client_id") WHERE status = 'active' and deleted_at is null;