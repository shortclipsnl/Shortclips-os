CREATE TABLE "ops_control_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_key" varchar(200) NOT NULL,
	"domain" varchar(24) NOT NULL,
	"category" varchar(60) NOT NULL,
	"client_id" uuid,
	"client_label" varchar(160),
	"owner_id" uuid,
	"action" varchar(200) NOT NULL,
	"reason" text,
	"href" varchar(300),
	"priority" varchar(10) DEFAULT 'normaal' NOT NULL,
	"severity" varchar(10) DEFAULT 'oranje' NOT NULL,
	"due_on" date,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"resolution" varchar(12),
	"verifiable" boolean DEFAULT true NOT NULL,
	"task_id" uuid,
	"manual_done_count" integer DEFAULT 0 NOT NULL,
	"snoozed_until" date,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"escalated_at" timestamp with time zone,
	"escalated_to_id" uuid,
	"jarno_notified_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_control_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_date" date NOT NULL,
	"slot" varchar(12) NOT NULL,
	"status" varchar(12) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"triggered_by_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops_control_items" ADD CONSTRAINT "ops_control_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_control_items" ADD CONSTRAINT "ops_control_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_control_items" ADD CONSTRAINT "ops_control_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_control_items" ADD CONSTRAINT "ops_control_items_escalated_to_id_users_id_fk" FOREIGN KEY ("escalated_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_control_runs" ADD CONSTRAINT "ops_control_runs_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ops_control_items_key_unique" ON "ops_control_items" USING btree ("item_key");--> statement-breakpoint
CREATE INDEX "ops_control_items_owner_idx" ON "ops_control_items" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "ops_control_items_status_idx" ON "ops_control_items" USING btree ("status","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_control_runs_slot_unique" ON "ops_control_runs" USING btree ("run_date","slot") WHERE "ops_control_runs"."slot" <> 'handmatig';--> statement-breakpoint
CREATE INDEX "ops_control_runs_started_idx" ON "ops_control_runs" USING btree ("started_at");