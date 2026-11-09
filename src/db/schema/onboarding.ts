import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";
import { salesLeads } from "./finance";

/**
 * Klantonboarding: wat er gebeurt tussen "lead akkoord" en de eerste opnamedag.
 *
 * Eén rij per klant (unieke index op client_id) en hooguit één per lead (unieke
 * index op lead_id), zodat dezelfde lead nooit twee keer wordt omgezet.
 *
 * De voortgang wordt grotendeels AFGELEID uit bestaande data (Drive-koppeling,
 * coördinator, portaallogin, taken, opnames uit Google Agenda). Hier staan alleen
 * de dingen die nergens anders staan: de afspraken uit het controlevenster, het
 * welkomstconcept, de technische stappen (pogingen, fouten) en het logboek.
 */
export type OnboardingStepState = {
  status: "open" | "bezig" | "klaar" | "mislukt";
  attempts: number;
  error?: string | null;
  at?: string | null;
};

export type OnboardingLogEntry = { at: string; step: string; event: string; detail?: string | null; actor?: string | null };

export type OnboardingDetails = {
  pakket: "org6" | "org8" | "ads6" | "ads8" | "anders";
  shortsPerMonth: number;
  contentFocus: "organisch" | "advertentie";
  contractMonths: number | null;
  publisher: "shortclips" | "klant";
  notes: string | null;
};

export const clientOnboardings = pgTable(
  "client_onboardings",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => salesLeads.id, { onDelete: "set null" }),
    startedById: uuid("started_by_id").references(() => users.id, { onDelete: "set null" }),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`).$type<OnboardingDetails>(),
    /** Technische stappen (drive, melding, taken): status, pogingen, laatste fout. */
    steps: jsonb("steps").notNull().default(sql`'{}'::jsonb`).$type<Record<string, OnboardingStepState>>(),
    log: jsonb("log").notNull().default(sql`'[]'::jsonb`).$type<OnboardingLogEntry[]>(),
    welcomeMessage: text("welcome_message"),
    /** Drive-id van het gekoppelde welkomstbestand (organisch of advertentie). */
    welcomeFileId: varchar("welcome_file_id", { length: 200 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("client_onboardings_client_unique").on(t.clientId),
    uniqueIndex("client_onboardings_lead_unique").on(t.leadId).where(sql`${t.leadId} is not null`),
    index("client_onboardings_completed_idx").on(t.completedAt),
  ],
);
