ALTER TABLE "tasks" ADD COLUMN "source" varchar(16) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "dedupe_key" varchar(200);--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_dedupe_open_unique" ON "tasks" USING btree ("dedupe_key") WHERE "tasks"."dedupe_key" is not null and "tasks"."status" <> 'done' and "tasks"."deleted_at" is null;