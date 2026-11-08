CREATE TABLE "editor_status_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"editor_id" uuid NOT NULL,
	"kind" varchar(16) DEFAULT 'halfway' NOT NULL,
	"cycle_key" varchar(60) NOT NULL,
	"editor_due_on" date,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(16),
	"note" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editor_status_checks_cycle_unique" UNIQUE("deliverable_id","kind","cycle_key")
);
--> statement-breakpoint
ALTER TABLE "editor_status_checks" ADD CONSTRAINT "editor_status_checks_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_status_checks" ADD CONSTRAINT "editor_status_checks_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editor_status_checks_editor_idx" ON "editor_status_checks" USING btree ("editor_id","responded_at");--> statement-breakpoint
CREATE INDEX "editor_status_checks_deliverable_idx" ON "editor_status_checks" USING btree ("deliverable_id","sent_at");