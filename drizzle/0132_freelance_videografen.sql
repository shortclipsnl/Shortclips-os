CREATE TABLE "videographer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"photo" text,
	"city" varchar(120),
	"regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phone" varchar(40),
	"whatsapp" varchar(40),
	"email" varchar(320),
	"portfolio_url" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"specialisations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'in_gesprek' NOT NULL,
	"availability" varchar(20) DEFAULT 'onbekend' NOT NULL,
	"availability_note" varchar(300),
	"availability_confirmed_at" date,
	"availability_confirmed_by_id" uuid,
	"day_rate" integer,
	"hourly_rate" integer,
	"rate_note" varchar(200),
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collaboration_note" text,
	"source" varchar(24) DEFAULT 'handmatig' NOT NULL,
	"source_label" varchar(200),
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
ALTER TABLE "videographer_contacts" ADD CONSTRAINT "videographer_contacts_availability_confirmed_by_id_users_id_fk" FOREIGN KEY ("availability_confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videographer_contacts" ADD CONSTRAINT "videographer_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videographer_contacts" ADD CONSTRAINT "videographer_contacts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videographer_contacts" ADD CONSTRAINT "videographer_contacts_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "videographer_contacts_status_idx" ON "videographer_contacts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "videographer_contacts_user_idx" ON "videographer_contacts" USING btree ("user_id") WHERE "videographer_contacts"."user_id" is not null;--> statement-breakpoint
-- Enige freelance videograaf die het team zelf heeft genoemd (12 nov 2026): Nathan, momenteel niet actief.
-- Alleen de voornaam en de status zijn bekend; al het andere blijft leeg ("Nog aanvullen").
INSERT INTO "videographer_contacts" ("full_name", "status", "source", "source_label")
SELECT 'Nathan', 'niet_actief', 'bekend', 'Door Jarno genoemd (12 nov 2026): freelance videograaf, momenteel niet actief. Overige gegevens nog aanvullen.'
WHERE NOT EXISTS (SELECT 1 FROM "videographer_contacts" WHERE lower("full_name") LIKE 'nathan%');
