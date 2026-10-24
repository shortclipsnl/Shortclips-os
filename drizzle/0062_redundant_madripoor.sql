CREATE TABLE "deadline_misses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(24) NOT NULL,
	"entity_id" uuid NOT NULL,
	"responsible_user_id" uuid,
	"client_id" uuid,
	"title" varchar(300),
	"due_on" date NOT NULL,
	"first_late_on" date NOT NULL,
	"resolved_on" date,
	"resolved" boolean DEFAULT false NOT NULL,
	"days_late" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_misses_entity_unique" UNIQUE("entity_type","entity_id")
);
--> statement-breakpoint
CREATE INDEX "deadline_misses_user_idx" ON "deadline_misses" USING btree ("responsible_user_id");--> statement-breakpoint
CREATE INDEX "deadline_misses_resolved_idx" ON "deadline_misses" USING btree ("resolved");