CREATE TABLE "client_agreement_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_agreement_overrides_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "client_agreement_overrides" ADD CONSTRAINT "client_agreement_overrides_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_agreement_overrides" ADD CONSTRAINT "client_agreement_overrides_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;