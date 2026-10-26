CREATE TYPE "public"."script_review_status" AS ENUM('klaar_controle', 'feedback_gegeven', 'wordt_aangepast', 'opnieuw_controle', 'goedgekeurd');--> statement-breakpoint
CREATE TABLE "script_review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"author_name" varchar(160),
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_review_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"page_number" integer,
	"pos_x" numeric(6, 5),
	"pos_y" numeric(6, 5),
	"visibility" varchar(10) DEFAULT 'client' NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"created_by_id" uuid,
	"author_name" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "script_review_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"data_base64" text NOT NULL,
	"note" text,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_review_versions_unique" UNIQUE("review_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "script_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"production_day_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"status" "script_review_status" DEFAULT 'klaar_controle' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"feedback_deadline" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_version" integer,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "script_review_comments" ADD CONSTRAINT "script_review_comments_thread_id_script_review_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."script_review_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_review_comments" ADD CONSTRAINT "script_review_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_review_threads" ADD CONSTRAINT "script_review_threads_review_id_script_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."script_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_review_threads" ADD CONSTRAINT "script_review_threads_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_review_threads" ADD CONSTRAINT "script_review_threads_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_review_versions" ADD CONSTRAINT "script_review_versions_review_id_script_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."script_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_review_versions" ADD CONSTRAINT "script_review_versions_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_reviews" ADD CONSTRAINT "script_reviews_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_reviews" ADD CONSTRAINT "script_reviews_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_reviews" ADD CONSTRAINT "script_reviews_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_reviews" ADD CONSTRAINT "script_reviews_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "script_review_comments_thread_idx" ON "script_review_comments" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "script_review_threads_review_idx" ON "script_review_threads" USING btree ("review_id","version_number");--> statement-breakpoint
CREATE INDEX "script_reviews_client_idx" ON "script_reviews" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "script_reviews_day_idx" ON "script_reviews" USING btree ("production_day_id");