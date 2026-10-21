CREATE TABLE "editor_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"award_key" varchar(40) NOT NULL,
	"achieved_at" timestamp with time zone NOT NULL,
	"video_id" uuid,
	"celebrated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editor_awards_unique" UNIQUE("editor_id","award_key")
);
--> statement-breakpoint
CREATE TABLE "editor_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"showcase_enabled" boolean DEFAULT true NOT NULL,
	"award_sound" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editor_awards" ADD CONSTRAINT "editor_awards_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_awards" ADD CONSTRAINT "editor_awards_video_id_deliverables_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_preferences" ADD CONSTRAINT "editor_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editor_awards_editor_idx" ON "editor_awards" USING btree ("editor_id");