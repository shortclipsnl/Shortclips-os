CREATE TABLE "boekhoud_balansen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"peildatum" date NOT NULL,
	"periode" varchar(60) DEFAULT '' NOT NULL,
	"regels" jsonb NOT NULL,
	"winst_verlies" jsonb,
	"bronbestand" varchar(300) DEFAULT '' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boekhoud_balansen_peildatum_unique" UNIQUE("peildatum")
);
