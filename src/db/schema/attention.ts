import { index, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Aandachtspunten — wat het team met een punt gedaan heeft
 * ------------------------------------------------------------------ */

/**
 * De automatische aandachtspunten worden live berekend (zie
 * `src/server/quality.ts`). Deze tabel bewaart alleen wat een teamlid ermee
 * doet: opgepakt, afgerond, aan iemand anders toegewezen, notities. Daarnaast
 * staan hier de handmatig toegevoegde punten (`manual = 'true'`).
 *
 * `signalKey` is het stabiele id van het signaal (bijv. `notsent-<videoId>`),
 * zodat de status blijft hangen zolang het signaal bestaat. Lost het onderliggende
 * probleem zich op, dan verdwijnt het signaal en is deze rij niet meer zichtbaar.
 */
export type AttentionNote = { at: string; userId: string; name: string; text: string };

export const attentionStates = pgTable(
  "attention_states",
  {
    id: pk(),
    signalKey: varchar("signal_key", { length: 200 }).notNull(),
    /** open | bezig | klaar */
    status: varchar("status", { length: 12 }).notNull().default("open"),
    /** Handmatig gekozen verantwoordelijke; leeg = automatische verdeling. */
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneById: uuid("done_by_id").references(() => users.id, { onDelete: "set null" }),
    notes: jsonb("notes").$type<AttentionNote[]>().notNull().default([]),
    /** Handmatig punt: deze velden vullen de lijst in plaats van een signaal. */
    manual: varchar("manual", { length: 5 }).notNull().default("false"),
    title: varchar("title", { length: 160 }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    clientLabel: varchar("client_label", { length: 160 }),
    category: varchar("category", { length: 20 }),
    priority: varchar("priority", { length: 10 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Laatste keer dat de verantwoordelijke een melding kreeg (tegen dubbele meldingen). */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    reason: text("reason"),
    ...timestamps,
  },
  (t) => [
    unique("attention_states_signal_unique").on(t.signalKey),
    index("attention_states_assignee_idx").on(t.assigneeId, t.status),
  ],
);
