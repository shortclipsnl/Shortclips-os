import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { users } from "./identity";
import { salesLeads } from "./finance";

/** Status van één fase in de leadreis. */
export type JourneyStatus = "nog_niet" | "bezig" | "wacht_klant" | "klaar";

export type JourneyPhaseState = {
  status: JourneyStatus;
  /** Handmatig gekozen verantwoordelijke (anders de standaard van de fase). */
  assigneeId?: string | null;
  /** Afgevinkte checklistpunten. */
  checks?: Record<string, boolean>;
  doneAt?: string | null;
  doneBy?: string | null;
};

/**
 * Leadreis: de onboarding-checklist per lead (fase 1 t/m 8).
 * Eén rij per lead. Alles wat afgeleid kan worden (offerte verstuurd/getekend,
 * klant aangemaakt, WhatsApp-link, kickoff in agenda) wordt NIET hier opgeslagen
 * maar live berekend. Hier staan alleen handmatige keuzes en aanpassingen.
 */
export const leadJourneys = pgTable(
  "lead_journeys",
  {
    id: pk(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => salesLeads.id, { onDelete: "cascade" }),
    phases: jsonb("phases").notNull().default(sql`'{}'::jsonb`).$type<Record<string, JourneyPhaseState>>(),
    /** Aangepaste berichten voor alleen deze lead (sleutel = berichtsleutel). */
    messages: jsonb("messages").notNull().default(sql`'{}'::jsonb`).$type<Record<string, string>>(),
    /** Per lead in te vullen links, bijvoorbeeld de PandaDoc-link van het voorstel. */
    links: jsonb("links").notNull().default(sql`'{}'::jsonb`).$type<Record<string, string>>(),
    startedById: uuid("started_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("lead_journeys_lead_unique").on(t.leadId)],
);

/**
 * Centrale standaardberichten en vaste links (kickoff-link, voorstelvideo).
 * `kind` = "message" of "link". Leeg of afwezig = de standaardtekst uit de code.
 */
export const journeyTemplates = pgTable(
  "journey_templates",
  {
    id: pk(),
    key: varchar("key", { length: 60 }).notNull(),
    kind: varchar("kind", { length: 12 }).notNull().default("message"),
    body: text("body").notNull().default(""),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("journey_templates_key_unique").on(t.key)],
);
