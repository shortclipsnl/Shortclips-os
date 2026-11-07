CREATE TABLE "bank_afschriften" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iban" varchar(34) NOT NULL,
	"rekening_naam" varchar(120) DEFAULT '' NOT NULL,
	"van" date NOT NULL,
	"tot" date NOT NULL,
	"beginsaldo" numeric(12, 2),
	"eindsaldo" numeric(12, 2),
	"aantal" integer DEFAULT 0 NOT NULL,
	"totaal_bij" numeric(12, 2),
	"totaal_af" numeric(12, 2),
	"bronbestand" varchar(300) DEFAULT '' NOT NULL,
	"controle" text DEFAULT '' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_afschriften_iban_periode_unique" UNIQUE("iban","van","tot")
);
--> statement-breakpoint
CREATE TABLE "bank_transacties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iban" varchar(34) NOT NULL,
	"ref" varchar(80) NOT NULL,
	"boekdatum" date NOT NULL,
	"valutadatum" date,
	"maand" varchar(7) NOT NULL,
	"bedrag" numeric(12, 2) NOT NULL,
	"tegenpartij" varchar(200) DEFAULT '' NOT NULL,
	"tegenrekening" varchar(40) DEFAULT '' NOT NULL,
	"omschrijving" text DEFAULT '' NOT NULL,
	"bankcode" varchar(40) DEFAULT '' NOT NULL,
	"bronbestand" varchar(300) DEFAULT '' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transacties_iban_ref_unique" UNIQUE("iban","ref")
);
--> statement-breakpoint
CREATE INDEX "bank_transacties_maand_idx" ON "bank_transacties" USING btree ("maand");--> statement-breakpoint
CREATE INDEX "bank_transacties_boekdatum_idx" ON "bank_transacties" USING btree ("boekdatum");