import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { users } from "./identity";
import { tasks } from "./production";

/* ------------------------------------------------------------------ *
 * Editor Meetings: het maandelijkse gesprek tussen een editor en de
 * verantwoordelijke content creator (Milou of Jiska).
 *
 * Statusvelden zijn bewust varchar (geen pg-enum), zodat waarden later
 * zonder zware migratie kunnen worden uitgebreid.
 * ------------------------------------------------------------------ */

/**
 * Vaste verantwoordelijke per editor. Ontbreekt de rij, dan leidt het portaal
 * een voorstel af uit de klanten waar de editor voor werkt (coördinator van die
 * klanten). Zodra iemand de verantwoordelijke bevestigt, staat die hier vast.
 */
export const editorMeetingOwners = pgTable(
  "editor_meeting_owners",
  {
    id: pk(),
    editorId: uuid("editor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    setById: uuid("set_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [unique("editor_meeting_owners_editor_unique").on(t.editorId)],
);

export type EditorMeetingReport = {
  /** Belangrijkste inzichten van de meeting. */
  insights?: string;
  /** Aandachtspunten voor de komende maand. */
  focusNext?: string;
};

/**
 * Eén rij per editor per maand (`period` = YYYY-MM, de maand waarin de meeting
 * plaatsvindt; besproken wordt de maand ervoor). De unieke sleutel maakt een
 * dubbele meeting onmogelijk: verplaatsen of opnieuw plannen werkt dezelfde rij bij.
 *
 *  - status:       gepland | geannuleerd
 *  - reportStatus: geen | concept | gepubliceerd. Alleen een gepubliceerd
 *    verslag is zichtbaar voor de editor.
 *  - internalNotes: interne notities van de content creator, nooit zichtbaar
 *    voor de editor.
 */
export const editorMeetings = pgTable(
  "editor_meetings",
  {
    id: pk(),
    editorId: uuid("editor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    period: varchar("period", { length: 7 }).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    location: varchar("location", { length: 160 }),
    meetingUrl: text("meeting_url"),
    /** Bespreekpunten, zichtbaar voor de editor. */
    topics: jsonb("topics").notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
    status: varchar("status", { length: 16 }).notNull().default("gepland"),
    reportStatus: varchar("report_status", { length: 16 }).notNull().default("geen"),
    report: jsonb("report").notNull().default(sql`'{}'::jsonb`).$type<EditorMeetingReport>(),
    internalNotes: text("internal_notes"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedById: uuid("published_by_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("editor_meetings_editor_period_unique").on(t.editorId, t.period),
    index("editor_meetings_owner_idx").on(t.ownerId, t.period),
    index("editor_meetings_period_idx").on(t.period),
  ],
);

/**
 * Punten uit het verslag.
 *  - kind:   sterk (wat ging goed) | verbeterpunt | vaardigheid (nieuw te
 *            ontwikkelen) | shortclips (feedback van de editor op Shortclips)
 *  - theme:  vast thema, zodat terugkerende punten herkend kunnen worden
 *  - status: open | behaald (alleen voor verbeterpunt en vaardigheid)
 */
export const editorMeetingPoints = pgTable(
  "editor_meeting_points",
  {
    id: pk(),
    meetingId: uuid("meeting_id").notNull().references(() => editorMeetings.id, { onDelete: "cascade" }),
    editorId: uuid("editor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    theme: varchar("theme", { length: 24 }).notNull().default("overig"),
    body: text("body").notNull(),
    /** Concreet voorbeeld bij een verbeterpunt. */
    example: text("example"),
    status: varchar("status", { length: 12 }).notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("editor_meeting_points_meeting_idx").on(t.meetingId),
    index("editor_meeting_points_editor_idx").on(t.editorId, t.kind),
  ],
);

/**
 * Actiepunten uit een meeting. De status staat niet hier maar op de gekoppelde
 * taak (`taskId`), zodat afvinken op de takenpagina, in het editorportaal en in
 * het verslag altijd hetzelfde laat zien. Een actiepunt zonder taak hoort bij
 * een conceptverslag; bij publiceren wordt de taak aangemaakt.
 *  - ownerType: editor | content_creator | shortclips
 */
export const editorMeetingActions = pgTable(
  "editor_meeting_actions",
  {
    id: pk(),
    meetingId: uuid("meeting_id").notNull().references(() => editorMeetings.id, { onDelete: "cascade" }),
    editorId: uuid("editor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    ownerType: varchar("owner_type", { length: 16 }).notNull().default("editor"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueOn: date("due_on"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("editor_meeting_actions_meeting_idx").on(t.meetingId),
    index("editor_meeting_actions_editor_idx").on(t.editorId),
    index("editor_meeting_actions_task_idx").on(t.taskId),
  ],
);

/**
 * Bespreekpunten die de editor zelf inbrengt ("Wat wil ik bespreken?").
 *
 * Een open punt hoort automatisch bij de eerstvolgende meeting: het staat in
 * beeld bij de editor, bij de verantwoordelijke content creator op de
 * meetingpagina en in het verslagformulier, tot het is behandeld. Bij het
 * verslag legt de content creator vast wat ermee is gebeurd; vanaf dat moment
 * is het punt gekoppeld aan die meeting (`meetingId`) en bewaard in het verslag.
 *
 *  - status:  open | behandeld
 *  - outcome: besproken | actiepunt | verbeterpunt (alleen bij behandeld).
 *    Omzetten maakt in hetzelfde verslag een actiepunt of verbeterpunt aan,
 *    zodat niemand iets dubbel hoeft in te voeren.
 *  - Voor de editor telt een punt pas als behandeld zodra het verslag is
 *    gepubliceerd; een conceptverslag blijft intern.
 */
export const editorMeetingItems = pgTable(
  "editor_meeting_items",
  {
    id: pk(),
    editorId: uuid("editor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    outcome: varchar("outcome", { length: 16 }),
    meetingId: uuid("meeting_id").references(() => editorMeetings.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    handledById: uuid("handled_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("editor_meeting_items_editor_idx").on(t.editorId, t.status),
    index("editor_meeting_items_meeting_idx").on(t.meetingId),
  ],
);
