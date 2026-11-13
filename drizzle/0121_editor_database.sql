CREATE TABLE "editor_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"phone" varchar(40),
	"whatsapp" varchar(40),
	"email" varchar(320),
	"portfolio_url" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"specialisations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" varchar(16) DEFAULT 'potentieel' NOT NULL,
	"worked_with_us" varchar(12) DEFAULT 'onbekend' NOT NULL,
	"collaboration_note" text,
	"rate_per_video" integer,
	"rate_note" varchar(200),
	"availability" varchar(20) DEFAULT 'onbekend' NOT NULL,
	"availability_note" varchar(300),
	"availability_confirmed_at" date,
	"availability_confirmed_by_id" uuid,
	"rating_quality" smallint,
	"rating_collaboration" smallint,
	"favorite" boolean DEFAULT false NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unverified_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" varchar(24) DEFAULT 'handmatig' NOT NULL,
	"source_label" varchar(120),
	"user_id" uuid,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "editor_contacts" ADD CONSTRAINT "editor_contacts_availability_confirmed_by_id_users_id_fk" FOREIGN KEY ("availability_confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_contacts" ADD CONSTRAINT "editor_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_contacts" ADD CONSTRAINT "editor_contacts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_contacts" ADD CONSTRAINT "editor_contacts_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editor_contacts_category_idx" ON "editor_contacts" USING btree ("category");--> statement-breakpoint
CREATE INDEX "editor_contacts_user_idx" ON "editor_contacts" USING btree ("user_id");