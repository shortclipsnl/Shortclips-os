CREATE TABLE "checklist_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"on_date" date NOT NULL,
	"slot_key" varchar(32) NOT NULL,
	"confirmed_by_id" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_checks_unique" UNIQUE("on_date","slot_key")
);
--> statement-breakpoint
ALTER TABLE "checklist_checks" ADD CONSTRAINT "checklist_checks_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;