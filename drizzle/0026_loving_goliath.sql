CREATE TABLE "calendar_couplings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" varchar(320) NOT NULL,
	"label" varchar(200),
	"color" varchar(16) DEFAULT '#2E90FA' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_couplings_calendar_id_unique" UNIQUE("calendar_id")
);
