import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, timestamps } from "./_shared";
import { users } from "./identity";

/**
 * Doelen (Q4-kwartaaldoelen). Bewust met varchar-statusvelden i.p.v. pg-enums,
 * zodat we waarden kunnen toevoegen zonder zware enum-migraties.
 *
 *  pillar:     sales | productie | team | systemen
 *  type:       count | norm | weekly | monthly | milestone
 *  source:     live | manual
 *  visibility: team | founders   (founders = alleen de eigenaar)
 *  status:     gepland | op_koers | risico | achter | niet_bijgewerkt | gehaald
 */
export const goals = pgTable(
  "goals",
  {
    id: pk(),
    pillar: varchar("pillar", { length: 40 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    type: varchar("type", { length: 16 }).notNull().default("count"),
    source: varchar("source", { length: 8 }).notNull().default("manual"),
    /** Welke live-meting voedt `current` (alleen bij source = live). */
    metricKey: varchar("metric_key", { length: 48 }),
    current: numeric("current", { precision: 14, scale: 2 }).notNull().default("0"),
    /** Leeg = doel nog niet ingesteld (toon "Doel nog instellen"). */
    target: numeric("target", { precision: 14, scale: 2 }),
    unit: varchar("unit", { length: 24 }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    visibility: varchar("visibility", { length: 10 }).notNull().default("team"),
    status: varchar("status", { length: 16 }).notNull().default("gepland"),
    previousStatus: varchar("previous_status", { length: 16 }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    /** Handmatig als "behaald" afgevinkt. Pint de status op "gehaald", los van
     *  de automatische herberekening (die zou het anders elke nacht overschrijven). */
    achievedManually: boolean("achieved_manually").notNull().default(false),
    achievedAt: timestamp("achieved_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("goals_pillar_idx").on(t.pillar),
    index("goals_owner_idx").on(t.ownerId),
  ],
);

/** Handmatige standupdates (en gestructureerde logs via `meta`). */
export const goalUpdates = pgTable(
  "goal_updates",
  {
    id: pk(),
    goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
    value: numeric("value", { precision: 14, scale: 2 }),
    note: text("note"),
    /** Vrije, gestructureerde velden per logregel (bijv. prospect, datum, link). */
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("goal_updates_goal_idx").on(t.goalId, t.createdAt)],
);

/** Mijlpaaldoelen: afvinkbare checklist per doel. */
export const goalMilestones = pgTable(
  "goal_milestones",
  {
    id: pk(),
    goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true }),
    dueDate: date("due_date"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("goal_milestones_goal_idx").on(t.goalId)],
);

/** Nachtelijke momentopname van stand + status, voor het verloop. */
export const goalSnapshots = pgTable(
  "goal_snapshots",
  {
    id: pk(),
    goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
    snapshotOn: date("snapshot_on").notNull(),
    current: numeric("current", { precision: 14, scale: 2 }).notNull().default("0"),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [unique("goal_snapshots_unique").on(t.goalId, t.snapshotOn)],
);
