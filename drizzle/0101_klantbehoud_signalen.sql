CREATE TABLE "client_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"source" varchar(16) DEFAULT 'overig' NOT NULL,
	"kind" varchar(12) NOT NULL,
	"category" varchar(16) DEFAULT 'overig' NOT NULL,
	"summary" varchar(240) NOT NULL,
	"quote" text,
	"follow_up" text NOT NULL,
	"due_on" date NOT NULL,
	"owner_id" uuid,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"resolution" text,
	"suggestion" jsonb,
	"source_ref" varchar(200),
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "verified_by_id" uuid;--> statement-breakpoint
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_feedback_client_idx" ON "client_feedback" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "client_feedback_open_idx" ON "client_feedback" USING btree ("status","kind");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;