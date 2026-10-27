CREATE TABLE "portal_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"purpose" varchar(16) DEFAULT 'invite' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_invites_token_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "portal_invites" ADD CONSTRAINT "portal_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_invites_user_idx" ON "portal_invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portal_invites_expiry_idx" ON "portal_invites" USING btree ("expires_at");