CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(32) DEFAULT 'google_calendar' NOT NULL,
	"calendar_id" varchar(320) NOT NULL,
	"calendar_name" varchar(200),
	"external_id" varchar(320) NOT NULL,
	"client_id" uuid,
	"kind" varchar(32) DEFAULT 'overig' NOT NULL,
	"title" varchar(300),
	"description" text,
	"location" varchar(300),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"html_link" text,
	"status" varchar(24),
	"match_confidence" varchar(16) DEFAULT 'none' NOT NULL,
	"match_reason" text,
	"matched_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_unique" UNIQUE("source","calendar_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_client_idx" ON "calendar_events" USING btree ("client_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_date_idx" ON "calendar_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_kind_idx" ON "calendar_events" USING btree ("client_id","kind");