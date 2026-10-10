import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { users } from "./identity";
import { tasks } from "./production";

/* ------------------------------------------------------------------ *
 * Vakantieplanning (#11)
 * ------------------------------------------------------------------ */

export const leaveStatusEnum = pgEnum("leave_status", ["requested", "approved", "rejected"]);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startOn: date("start_on").notNull(),
    endOn: date("end_on").notNull(),
    /** vakantie, vrije dag, ziek, bijzonder verlof. */
    kind: varchar("kind", { length: 32 }).notNull().default("vakantie"),
    status: leaveStatusEnum("status").notNull().default("requested"),
    note: text("note"),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("leave_requests_user_idx").on(t.userId),
    index("leave_requests_range_idx").on(t.startOn, t.endOn),
    index("leave_requests_status_idx").on(t.status),
  ],
);

/* ------------------------------------------------------------------ *
 * Teammeetings (#12)
 * ------------------------------------------------------------------ */

export const teamMeetings = pgTable(
  "team_meetings",
  {
    id: pk(),
    title: varchar("title", { length: 200 }).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    location: varchar("location", { length: 160 }),
    /** Deelnemers als user-id's. */
    participantIds: jsonb("participant_ids").notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("team_meetings_date_idx").on(t.scheduledAt)],
);

export const meetingItems = pgTable(
  "meeting_items",
  {
    id: pk(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => teamMeetings.id, { onDelete: "cascade" }),
    /** agenda = bespreekpunt, decision = besluit, action = actiepunt. */
    kind: varchar("kind", { length: 16 }).notNull().default("agenda"),
    body: text("body").notNull(),
    /** Alleen voor actiepunten. */
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueOn: date("due_on"),
    /** Gekoppelde taak in het Taken-overzicht (actiepunt → taak). */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    isDone: boolean("is_done").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("meeting_items_meeting_idx").on(t.meetingId, t.kind)],
);

/* ------------------------------------------------------------------ *
 * Dagelijkse checklist — gedeelde bevestigingen per dag (#1)
 * ------------------------------------------------------------------ */

/**
 * Eén rij = een bevestigd checklistonderdeel op een bepaalde dag. Een onderdeel
 * wordt pas "afgerond" (groen) als iemand het bevestigt; het verstrijken van de
 * tijd alléén markeert niets als voltooid. Gedeeld, zodat het hele team ziet wat
 * al is gedaan.
 */
export const checklistChecks = pgTable(
  "checklist_checks",
  {
    id: pk(),
    onDate: date("on_date").notNull(),
    slotKey: varchar("slot_key", { length: 32 }).notNull(),
    confirmedById: uuid("confirmed_by_id").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [unique("checklist_checks_unique").on(t.onDate, t.slotKey)],
);
