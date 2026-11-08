import { date, index, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { users } from "./identity";
import { deliverables } from "./video";

/* ------------------------------------------------------------------ *
 * Statuscheck editors: "hoe ver ben je?" halverwege de editor deadline
 * ------------------------------------------------------------------ */

/**
 * Eén rij per verstuurde statuscheck. De check wordt automatisch aangemaakt
 * (zie src/server/editor-status-checks.ts) en de editor beantwoordt hem met één
 * klik in zijn portaal. Team Shortclips leest de laatste rij per project op de
 * Editing-pagina en in Aandachtspunten.
 *
 *  - kind: "halfway" (50% van de bewerkingstijd verstreken) of "pre_deadline"
 *    (één werkdag voor de editor deadline, alleen bij risico).
 *  - cycleKey: fase + editor deadline (bijv. "first:2026-11-12"). Verschuift de
 *    deadline, dan ontstaat een nieuwe cyclus en wordt het moment opnieuw
 *    berekend. De unieke sleutel voorkomt dubbele checks binnen één cyclus.
 *  - status: bezig | nog_niet | bijna_klaar (leeg = nog niet beantwoord).
 */
export const editorStatusChecks = pgTable(
  "editor_status_checks",
  {
    id: pk(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull().default("halfway"),
    cycleKey: varchar("cycle_key", { length: 60 }).notNull(),
    /** De editor deadline op het moment van versturen. */
    editorDueOn: date("editor_due_on"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    status: varchar("status", { length: 16 }),
    note: text("note"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("editor_status_checks_cycle_unique").on(t.deliverableId, t.kind, t.cycleKey),
    index("editor_status_checks_editor_idx").on(t.editorId, t.respondedAt),
    index("editor_status_checks_deliverable_idx").on(t.deliverableId, t.sentAt),
  ],
);
