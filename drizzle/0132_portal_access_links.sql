-- Persoonlijke inloglinks voor het klantportaal (één tik vanuit WhatsApp).
-- Idempotent (IF NOT EXISTS), zodat de migratie veilig is bij parallelle branches.
CREATE TABLE IF NOT EXISTS "portal_access_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"client_id" uuid REFERENCES "clients"("id") ON DELETE cascade,
	"token_hash" varchar(64) NOT NULL,
	"target_path" varchar(300) NOT NULL,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"expires_at" timestamp with time zone NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"max_uses" integer DEFAULT 10 NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_access_links_token_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_access_links_user_idx" ON "portal_access_links" USING btree ("user_id","revoked_at");
