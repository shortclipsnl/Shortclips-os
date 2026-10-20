CREATE TABLE "kosten_omzet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"maand" varchar(7) NOT NULL,
	"omzet" numeric(12, 2) DEFAULT '0' NOT NULL,
	"bijgewerkt" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kosten_omzet_maand_unique" UNIQUE("maand")
);
--> statement-breakpoint
CREATE TABLE "kosten_regels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"maand" varchar(7) NOT NULL,
	"leverancier" varchar(200) NOT NULL,
	"subcategorie" varchar(80) NOT NULL,
	"groep" varchar(24) NOT NULL,
	"soort" varchar(16) NOT NULL,
	"met_btw" numeric(12, 2) DEFAULT '0' NOT NULL,
	"zonder_btw" numeric(12, 2) DEFAULT '0' NOT NULL,
	"aantal" integer DEFAULT 1 NOT NULL,
	"bijgewerkt" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "kosten_regels_maand_idx" ON "kosten_regels" USING btree ("maand");