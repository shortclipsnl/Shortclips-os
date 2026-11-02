ALTER TABLE "users" ADD COLUMN "ical_token" varchar(64);--> statement-breakpoint
CREATE INDEX "users_ical_token_idx" ON "users" USING btree ("ical_token");