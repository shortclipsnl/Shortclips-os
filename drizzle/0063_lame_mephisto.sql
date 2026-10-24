CREATE TABLE "development_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(16) DEFAULT 'vaardigheid' NOT NULL,
	"category" varchar(40) DEFAULT 'kwaliteit' NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"advies" text DEFAULT '' NOT NULL,
	"zekerheid" varchar(16) DEFAULT 'waarschijnlijk' NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"source" varchar(12) DEFAULT 'ai' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kb_course_id" uuid,
	"kb_lesson_id" uuid,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"dedupe_key" varchar(180),
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "development_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_on" date NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_snapshots_unique" UNIQUE("user_id","snapshot_on")
);
--> statement-breakpoint
ALTER TABLE "development_points" ADD CONSTRAINT "development_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_points" ADD CONSTRAINT "development_points_kb_course_id_kb_courses_id_fk" FOREIGN KEY ("kb_course_id") REFERENCES "public"."kb_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_points" ADD CONSTRAINT "development_points_kb_lesson_id_kb_lessons_id_fk" FOREIGN KEY ("kb_lesson_id") REFERENCES "public"."kb_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_points" ADD CONSTRAINT "development_points_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_points" ADD CONSTRAINT "development_points_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_snapshots" ADD CONSTRAINT "development_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "development_points_user_idx" ON "development_points" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "development_points_dedupe_idx" ON "development_points" USING btree ("dedupe_key");