import { sql } from "drizzle-orm";
import { date, index, integer, pgTable, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { clients } from "./clients";
import { tasks } from "./production";
import { deliverables } from "./video";

/* ------------------------------------------------------------------ *
 * Feedbackrondes klant: de termijn van "Feedback klant" per video
 * ------------------------------------------------------------------ */

/**
 * Eén rij per keer dat een video naar de klant gaat (fase Feedback klant).
 * De ronde start op het moment dat de video naar de klant ging
 * (`startedAt` = statuswissel naar client_review) en stopt zodra de video de
 * fase verlaat (`endedAt`). Een nieuwe feedbackronde is een nieuwe rij; oude
 * rondes blijven bewaard als geschiedenis.
 *
 *  - termDays: de feedbacktermijn in werkdagen bij de start (uit Instellingen >
 *    Klantportaal, per klant overschrijfbaar). Vastgelegd, zodat een latere
 *    wijziging van de instelling een lopende ronde niet ongemerkt verschuift.
 *  - revisionMark: clientRevisionRounds van de video bij de start. Is dat getal
 *    later hoger terwijl de video weer op Feedback klant staat, dan is er
 *    tussendoor een feedbackronde geweest: oude ronde dicht, nieuwe open.
 *  - reminderAt: wanneer de interne herinnering (melding + taak) is aangemaakt.
 *    Gevuld = nooit opnieuw voor deze ronde (geen dubbele taken/meldingen).
 */
export const clientFeedbackRounds = pgTable(
  "client_feedback_rounds",
  {
    id: pk(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Kalenderdag (Amsterdam) waarop de klant de video's ontving. */
    startedOn: date("started_on").notNull(),
    termDays: integer("term_days").notNull().default(3),
    /** Laatste dag binnen de termijn (startedOn + termDays werkdagen). */
    dueOn: date("due_on").notNull(),
    revisionMark: integer("revision_mark").notNull().default(0),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Status waarnaar de video ging bij het afsluiten (bijv. client_revision, approved). */
    endedStatus: varchar("ended_status", { length: 32 }),
    reminderAt: timestamp("reminder_at", { withTimezone: true }),
    reminderTaskId: uuid("reminder_task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** Ontvanger van de herinnering (de vaste verantwoordelijke van de klant). */
    reminderUserId: uuid("reminder_user_id"),
    ...timestamps,
  },
  (t) => [
    unique("client_feedback_rounds_number_unique").on(t.deliverableId, t.roundNumber),
    index("client_feedback_rounds_open_idx").on(t.endedAt, t.deliverableId),
    // Hooguit één lopende ronde per video, ook bij gelijktijdige synchronisaties.
    uniqueIndex("client_feedback_rounds_one_open").on(t.deliverableId).where(sql`${t.endedAt} is null`),
  ],
);
