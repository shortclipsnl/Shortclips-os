CREATE TABLE "attention_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_key" varchar(200) NOT NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"done_at" timestamp with time zone,
	"done_by_id" uuid,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manual" varchar(5) DEFAULT 'false' NOT NULL,
	"title" varchar(160),
	"client_id" uuid,
	"client_label" varchar(160),
	"category" varchar(20),
	"priority" varchar(10),
	"created_by_id" uuid,
	"notified_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_states_signal_unique" UNIQUE("signal_key")
);
--> statement-breakpoint
ALTER TABLE "attention_states" ADD CONSTRAINT "attention_states_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_states" ADD CONSTRAINT "attention_states_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_states" ADD CONSTRAINT "attention_states_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_states" ADD CONSTRAINT "attention_states_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attention_states_assignee_idx" ON "attention_states" USING btree ("assignee_id","status");