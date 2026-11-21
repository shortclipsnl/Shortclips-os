-- Register van verwerkte lead-mails: elke mail uit de leadsmap precies één keer,
-- met wat ermee gebeurd is (nieuwe lead, contactmoment, twijfel, genegeerd).
-- Idempotent (IF NOT EXISTS), zodat de migratie veilig is bij parallelle branches.
CREATE TABLE IF NOT EXISTS "lead_mail_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" varchar(400) NOT NULL,
  "received_at" timestamp with time zone,
  "form_type" varchar(80),
  "company" varchar(200),
  "contact_name" varchar(160),
  "email" varchar(160),
  "phone" varchar(40),
  "website" varchar(200),
  "original_text" text,
  "outcome" varchar(16) NOT NULL,
  "match_reason" varchar(300),
  "lead_id" uuid REFERENCES "sales_leads"("id") ON DELETE SET NULL,
  "candidate_lead_id" uuid REFERENCES "sales_leads"("id") ON DELETE SET NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lead_mail_events_message_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_mail_events_outcome_idx" ON "lead_mail_events" USING btree ("outcome");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_mail_events_lead_idx" ON "lead_mail_events" USING btree ("lead_id");
