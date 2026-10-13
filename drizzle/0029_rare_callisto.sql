CREATE TABLE "qc_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"label" varchar(160) NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_by_id" uuid,
	"done_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qc_checks_unique" UNIQUE("deliverable_id","label")
);
--> statement-breakpoint
ALTER TABLE "qc_checks" ADD CONSTRAINT "qc_checks_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_checks" ADD CONSTRAINT "qc_checks_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qc_checks_deliverable_idx" ON "qc_checks" USING btree ("deliverable_id");