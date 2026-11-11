ALTER TABLE "content_ideas" ADD COLUMN "doel" text;--> statement-breakpoint
ALTER TABLE "content_research_runs" ADD COLUMN "strategic_advice" jsonb DEFAULT '[]'::jsonb NOT NULL;