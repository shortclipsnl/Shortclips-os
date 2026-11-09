CREATE TABLE "script_review_page_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"page_number" integer NOT NULL,
	"approved_by_id" uuid,
	"approved_by_name" varchar(160),
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"carried_over" boolean DEFAULT false NOT NULL,
	CONSTRAINT "script_review_page_approvals_unique" UNIQUE("review_id","version_number","page_number")
);
--> statement-breakpoint
ALTER TABLE "script_review_versions" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "script_review_versions" ADD COLUMN "script_page_from" integer;--> statement-breakpoint
ALTER TABLE "script_review_versions" ADD COLUMN "script_page_to" integer;--> statement-breakpoint
ALTER TABLE "script_review_page_approvals" ADD CONSTRAINT "script_review_page_approvals_review_id_script_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."script_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_review_page_approvals" ADD CONSTRAINT "script_review_page_approvals_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;