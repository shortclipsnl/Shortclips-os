import { index, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { salesLeads } from "./finance";

/**
 * Register van verwerkte lead-mails (contactformulieren, Rocket Leads).
 *
 * Elke mail uit de leadsmap krijgt hier precies één regel, herkenbaar aan de
 * Message-ID. Daardoor wordt dezelfde mail nooit twee keer verwerkt, ook niet
 * als de synchronisatie opnieuw draait, en is per aanvraag terug te vinden wat
 * ermee gebeurd is:
 *  - created  : er is een nieuwe lead van gemaakt
 *  - attached : toegevoegd als contactmoment aan een bestaande lead
 *  - review   : twijfelgeval, wacht op handmatige beoordeling
 *  - ignored  : bewust overgeslagen (geen bruikbare gegevens of handmatig genegeerd)
 */
export const leadMailEvents = pgTable(
  "lead_mail_events",
  {
    id: pk(),
    messageId: varchar("message_id", { length: 400 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    formType: varchar("form_type", { length: 80 }),
    company: varchar("company", { length: 200 }),
    contactName: varchar("contact_name", { length: 160 }),
    email: varchar("email", { length: 160 }),
    phone: varchar("phone", { length: 40 }),
    website: varchar("website", { length: 200 }),
    originalText: text("original_text"),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    /** Waarom deze uitkomst: waarop de koppeling is gebaseerd of waarom er twijfel is. */
    matchReason: varchar("match_reason", { length: 300 }),
    leadId: uuid("lead_id").references(() => salesLeads.id, { onDelete: "set null" }),
    /** Bij twijfel: de bestaande lead die er het meest op lijkt (voorstel). */
    candidateLeadId: uuid("candidate_lead_id").references(() => salesLeads.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("lead_mail_events_message_unique").on(t.messageId),
    index("lead_mail_events_outcome_idx").on(t.outcome),
    index("lead_mail_events_lead_idx").on(t.leadId),
  ],
);
