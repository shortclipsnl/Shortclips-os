import { date, index, jsonb, pgTable, smallint, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

/**
 * Exitgesprek per gestopte of gepauzeerde klant (één per klant).
 * Antwoorden staan als vrije tekst per vraag; scores, opzegreden en conclusie
 * als vaste keuzes, zodat ze later per reden en oorzaak te tellen zijn.
 */
export const clientExitInterviews = pgTable(
  "client_exit_interviews",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    interviewDate: date("interview_date"),
    conductedById: uuid("conducted_by_id").references(() => users.id, { onDelete: "set null" }),
    endDate: date("end_date"),
    /** Aantekeningen per vraag: { q1: "...", ..., q7: "..." }. */
    answers: jsonb("answers").notNull().default({}),
    scoreResults: smallint("score_results"),
    scoreCollaboration: smallint("score_collaboration"),
    scoreValue: smallint("score_value"),
    primaryReason: varchar("primary_reason", { length: 32 }),
    secondaryReason: varchar("secondary_reason", { length: 32 }),
    otherReason: varchar("other_reason", { length: 240 }),
    /** Wat de klant letterlijk zegt. */
    quote: text("quote"),
    /** Onze eigen interpretatie. */
    interpretation: text("interpretation"),
    cause: varchar("cause", { length: 12 }),
    preventable: varchar("preventable", { length: 12 }),
    lesson: text("lesson"),
    /** Verbeteracties: [{ action, ownerId, dueOn }]. */
    actions: jsonb("actions").notNull().default([]),
    futurePossible: varchar("future_possible", { length: 12 }),
    followUpOn: date("follow_up_on"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("client_exit_interviews_client_uq").on(t.clientId),
    index("client_exit_interviews_reason_idx").on(t.primaryReason),
  ],
);

export type ClientExitInterview = typeof clientExitInterviews.$inferSelect;
