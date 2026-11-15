import { relations, sql } from "drizzle-orm";
import { date, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Klantonderzoek: automatisch onderzoeksdossier per klant.
 *
 * Eén rij per onderzoeksronde. De eerste ronde van een klant is de
 * NULMETING en blijft ongewijzigd bewaard; elke latere ronde (iedere
 * 90 dagen) is een HERCONTROLE die naast de nulmeting komt te staan.
 *
 * `dossier` is wat het onderzoek opleverde en wordt na afronding nooit
 * meer overschreven. Correcties en aanvullingen van het team staan los
 * daarvan in `corrections` en `additions`, zodat altijd zichtbaar blijft
 * wat het onderzoek vond en wat een mens heeft aangepast.
 *
 * Uitsluitend intern: deze tabel wordt nergens in het klantportaal gelezen.
 * ------------------------------------------------------------------ */

export const clientResearchRuns = pgTable(
  "client_research_runs",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** 'nulmeting' (eerste onderzoek) of 'hercontrole' (elke 90 dagen). */
    kind: varchar("kind", { length: 16 }).notNull().default("nulmeting"),
    /** bezig | controle (wacht op menselijke controle) | goedgekeurd | mislukt. */
    status: varchar("status", { length: 16 }).notNull().default("bezig"),
    /** Huidige fase; "wacht_<fase>" = de volgende aanroep pakt deze fase op. */
    phase: varchar("phase", { length: 32 }).notNull().default("intern"),
    /** Interne gegevens die het onderzoek als startpunt kreeg (klantgegevens, kanalen, briefing). */
    internal: jsonb("internal").notNull().default(sql`'{}'::jsonb`),
    /** Ruwe briefings uit het webonderzoek (bewaard zodat elke fase los kan draaien). */
    briefingCompany: text("briefing_company"),
    briefingSocial: text("briefing_social"),
    /** Het dossier: modules, kanalen, concurrenten, software, strategie. */
    dossier: jsonb("dossier"),
    /** Nulmeting: cijfers op de onderzoeksdatum, per herkomst (openbaar, gekoppeld, handmatig). */
    baseline: jsonb("baseline").notNull().default(sql`'[]'::jsonb`),
    /** Bronnen met klikbare links: { label, url }[]. */
    sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
    /** Welke databronnen dit onderzoek echt had. */
    dataBasis: jsonb("data_basis").notNull().default(sql`'{}'::jsonb`),
    /** Bij een hercontrole: wat er veranderd is ten opzichte van het vorige onderzoek. */
    changes: jsonb("changes").notNull().default(sql`'{}'::jsonb`),
    /** Correcties van het team per bevinding: { [bevindingId]: { tekst?, verborgen?, door, op } }. */
    corrections: jsonb("corrections").notNull().default(sql`'{}'::jsonb`),
    /** Aanvullingen van het team: { id, module, tekst, door, op }[]. */
    additions: jsonb("additions").notNull().default(sql`'[]'::jsonb`),
    attempts: integer("attempts").notNull().default(0),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    /** Wie het onderzoek startte (null = automatisch). */
    triggeredById: uuid("triggered_by_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Datum waarop de volgende hercontrole mag starten (goedkeuring + 90 dagen). */
    nextCheckOn: date("next_check_on"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("client_research_runs_client_idx").on(t.clientId, t.createdAt),
    index("client_research_runs_status_idx").on(t.status),
  ],
);

export const clientResearchRunsRelations = relations(clientResearchRuns, ({ one }) => ({
  client: one(clients, { fields: [clientResearchRuns.clientId], references: [clients.id] }),
}));
