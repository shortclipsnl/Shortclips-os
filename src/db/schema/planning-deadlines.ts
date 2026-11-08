import { relations, sql } from "drizzle-orm";
import { boolean, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

/**
 * Deadline voor de klant bij een gedeelde contentplanning (standaard 21 dagen).
 *
 * Start automatisch bij "Goedkeuren en delen met klant" als er voor die klant
 * nog geen deadline loopt. Per klant is er hooguit één actieve deadline (unieke
 * index), zodat er nooit dubbele deadlines ontstaan. Staat volledig los van de
 * publicatiedatums en publicatieautomatiseringen: dit is alleen een weergave en
 * een herinneringsritme richting de klant.
 */
export const planningDeadlines = pgTable(
  "planning_deadlines",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Dag waarop de planning beschikbaar is gesteld (YYYY-MM-DD, Amsterdam). */
    startedOn: date("started_on").notNull(),
    /** Uiterste deadline voor de klant (standaard startedOn + 21 dagen). */
    deadlineOn: date("deadline_on").notNull(),
    /** active | completed */
    status: varchar("status", { length: 16 }).notNull().default("active"),
    startedById: uuid("started_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Heeft er tijdens deze deadline iets bij de klant gelegen? Pas dan kan
     *  "niets meer open" automatisch als afgerond gelden. */
    hadClientActions: boolean("had_client_actions").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** auto | manual */
    completedVia: varchar("completed_via", { length: 16 }),
    completedById: uuid("completed_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Handmatige wijzigingen: [{ at, byName, from, to, reason }]. Staat ook in de audit log. */
    history: jsonb("history").notNull().default(sql`'[]'::jsonb`),
    note: text("note"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("planning_deadlines_client_idx").on(t.clientId, t.status),
    uniqueIndex("planning_deadlines_one_active").on(t.clientId).where(sql`status = 'active' and deleted_at is null`),
  ],
);

export const planningDeadlinesRelations = relations(planningDeadlines, ({ one }) => ({
  client: one(clients, { fields: [planningDeadlines.clientId], references: [clients.id] }),
}));
