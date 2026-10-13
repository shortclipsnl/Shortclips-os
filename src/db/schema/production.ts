import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import {
  productionStatusEnum,
  projectStatusEnum,
  scriptStatusEnum,
  taskPriorityEnum,
  taskStatusEnum,
} from "./enums";
import { clients } from "./clients";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Projecten & producties
 * ------------------------------------------------------------------ */

export const projects = pgTable(
  "projects",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("active"),
    /** Maandcyclus waar dit project bij hoort, formaat YYYY-MM. */
    period: varchar("period", { length: 7 }),
    startsOn: date("starts_on"),
    dueOn: date("due_on"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("projects_client_idx").on(t.clientId, t.status),
    index("projects_period_idx").on(t.period),
  ],
);

export const productions = pgTable(
  "productions",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 200 }).notNull(),
    status: productionStatusEnum("status").notNull().default("planned"),
    briefing: text("briefing"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("productions_client_idx").on(t.clientId, t.status)],
);

export const productionDays = pgTable(
  "production_days",
  {
    id: pk(),
    productionId: uuid("production_id").references(() => productions.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    scheduledOn: date("scheduled_on").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    locationName: varchar("location_name", { length: 200 }),
    locationAddress: text("location_address"),
    status: productionStatusEnum("status").notNull().default("planned"),
    /** Projectfase die automatisch meeloopt met de opnamedatum (overgenomen uit
     *  Monday): nieuw → scripting (−14d) → opnamevoorbereiding (−3d) →
     *  opname (0d) → editing (+1d). Los van `status` (planning/bevestiging). */
    phase: varchar("phase", { length: 24 }).notNull().default("nieuw"),
    /** Datum waarop de huidige fase inging. */
    phaseEnteredOn: date("phase_entered_on"),
    /** Scriptingstatus voor het Scripting-dashboard: afstemmen → concepting →
     *  klaar_shortclips → scriptmeeting → final. Blijft bij deze opname bewaard,
     *  ook als de opnamedatum verandert. "final" = klaar voor opname. */
    scriptingStatus: varchar("scripting_status", { length: 24 }).notNull().default("afstemmen"),
    videographerId: uuid("videographer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    coordinatorId: uuid("coordinator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Contactpersonen die op locatie aanwezig zijn (client_contacts ids). */
    contactIds: jsonb("contact_ids").notNull().default(sql`'[]'::jsonb`),
    schedule: text("schedule"),
    notes: text("notes"),
    /** Externe koppelingen zodat de map/het project direct te openen is. */
    driveFolderId: varchar("drive_folder_id", { length: 200 }),
    frameProjectId: varchar("frame_project_id", { length: 200 }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("production_days_client_idx").on(t.clientId, t.scheduledOn),
    index("production_days_date_idx").on(t.scheduledOn),
    index("production_days_videographer_idx").on(t.videographerId),
  ],
);

/** Checklist-items per opnamedag (benodigdheden, apparatuur, voorbereiding). */
export const productionChecklistItems = pgTable(
  "production_checklist_items",
  {
    id: pk(),
    productionDayId: uuid("production_day_id")
      .notNull()
      .references(() => productionDays.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 240 }).notNull(),
    category: varchar("category", { length: 48 }).notNull().default("general"),
    isDone: boolean("is_done").notNull().default(false),
    /** Blokkerend = opname kan niet door zonder dit item. */
    isBlocking: boolean("is_blocking").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("production_checklist_day_idx").on(t.productionDayId)],
);

/* ------------------------------------------------------------------ *
 * Scripts
 * ------------------------------------------------------------------ */

export const scripts = pgTable(
  "scripts",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    productionDayId: uuid("production_day_id").references(
      () => productionDays.id,
      { onDelete: "set null" },
    ),
    title: varchar("title", { length: 240 }).notNull(),
    status: scriptStatusEnum("status").notNull().default("idea"),
    /** Contentpijler uit de klantstrategie. */
    pillar: varchar("pillar", { length: 120 }),
    format: varchar("format", { length: 120 }),
    hook: text("hook"),
    body: text("body"),
    cta: text("cta"),
    shotList: text("shot_list"),
    requirements: text("requirements"),
    locationName: varchar("location_name", { length: 200 }),
    presenter: varchar("presenter", { length: 160 }),
    internalNotes: text("internal_notes"),
    clientNotes: text("client_notes"),
    creatorId: uuid("creator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Nummer van de laatste versie; versies staan in script_versions. */
    currentVersion: integer("current_version").notNull().default(1),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("scripts_client_idx").on(t.clientId, t.status),
    index("scripts_day_idx").on(t.productionDayId),
    index("scripts_status_idx").on(t.status),
  ],
);

export const scriptVersions = pgTable(
  "script_versions",
  {
    id: pk(),
    scriptId: uuid("script_id")
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    /** Volledige momentopname van de inhoud, zodat je kunt vergelijken. */
    snapshot: jsonb("snapshot").notNull(),
    changeSummary: text("change_summary"),
    status: scriptStatusEnum("status").notNull(),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    unique("script_versions_unique").on(t.scriptId, t.versionNumber),
    index("script_versions_script_idx").on(t.scriptId),
  ],
);

/* ------------------------------------------------------------------ *
 * Taken
 * ------------------------------------------------------------------ */

export const tasks = pgTable(
  "tasks",
  {
    id: pk(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueOn: date("due_on"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Gezet wanneer een afgeronde taak naar het archief is verplaatst; de taak
     *  blijft bestaan en terugvindbaar, maar verdwijnt uit het dagelijkse
     *  overzicht. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Waar deze taak over gaat: `video`, `script`, `production_day`, ... */
    entityType: varchar("entity_type", { length: 40 }),
    entityId: uuid("entity_id"),
    /** Automatisch aangemaakt door de automation engine. */
    createdByRuleId: uuid("created_by_rule_id"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("tasks_assignee_idx").on(t.assigneeId, t.status),
    index("tasks_client_idx").on(t.clientId, t.status),
    index("tasks_due_idx").on(t.dueOn),
    index("tasks_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: pk(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    blockedByTaskId: uuid("blocked_by_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    unique("task_dependencies_unique").on(t.taskId, t.blockedByTaskId),
    index("task_dependencies_task_idx").on(t.taskId),
  ],
);

/* ------------------------------------------------------------------ *
 * Relaties
 * ------------------------------------------------------------------ */

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
  productions: many(productions),
  tasks: many(tasks),
}));

export const productionsRelations = relations(productions, ({ one, many }) => ({
  client: one(clients, {
    fields: [productions.clientId],
    references: [clients.id],
  }),
  project: one(projects, {
    fields: [productions.projectId],
    references: [projects.id],
  }),
  days: many(productionDays),
}));

export const productionDaysRelations = relations(
  productionDays,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [productionDays.clientId],
      references: [clients.id],
    }),
    production: one(productions, {
      fields: [productionDays.productionId],
      references: [productions.id],
    }),
    videographer: one(users, {
      fields: [productionDays.videographerId],
      references: [users.id],
    }),
    scripts: many(scripts),
    checklist: many(productionChecklistItems),
  }),
);

export const productionChecklistItemsRelations = relations(
  productionChecklistItems,
  ({ one }) => ({
    productionDay: one(productionDays, {
      fields: [productionChecklistItems.productionDayId],
      references: [productionDays.id],
    }),
  }),
);

export const scriptsRelations = relations(scripts, ({ one, many }) => ({
  client: one(clients, { fields: [scripts.clientId], references: [clients.id] }),
  productionDay: one(productionDays, {
    fields: [scripts.productionDayId],
    references: [productionDays.id],
  }),
  creator: one(users, { fields: [scripts.creatorId], references: [users.id] }),
  versions: many(scriptVersions),
}));

export const scriptVersionsRelations = relations(scriptVersions, ({ one }) => ({
  script: one(scripts, {
    fields: [scriptVersions.scriptId],
    references: [scripts.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  client: one(clients, { fields: [tasks.clientId], references: [clients.id] }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  dependencies: many(taskDependencies),
}));

/* ------------------------------------------------------------------ *
 * Google Agenda — gesynchroniseerde afspraken
 * Eén afspraak per rij. clientId = null betekent: (nog) geen zekere klant,
 * belandt in de review in het beheer. Nooit stilletjes gokken.
 * ------------------------------------------------------------------ */

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: pk(),
    source: varchar("source", { length: 32 }).notNull().default("google_calendar"),
    calendarId: varchar("calendar_id", { length: 320 }).notNull(),
    calendarName: varchar("calendar_name", { length: 200 }),
    externalId: varchar("external_id", { length: 320 }).notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 32 }).notNull().default("overig"),
    title: varchar("title", { length: 300 }),
    description: text("description"),
    location: varchar("location", { length: 300 }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    attendees: jsonb("attendees").notNull().default(sql`'[]'::jsonb`),
    htmlLink: text("html_link"),
    status: varchar("status", { length: 24 }),
    matchConfidence: varchar("match_confidence", { length: 16 }).notNull().default("none"),
    matchReason: text("match_reason"),
    matchedBy: jsonb("matched_by").notNull().default(sql`'[]'::jsonb`),
    candidates: jsonb("candidates").notNull().default(sql`'[]'::jsonb`),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique("calendar_events_unique").on(t.source, t.calendarId, t.externalId),
    index("calendar_events_client_idx").on(t.clientId, t.startsAt),
    index("calendar_events_date_idx").on(t.startsAt),
    index("calendar_events_kind_idx").on(t.clientId, t.kind),
  ],
);

export const calendarEventsRelations = relations(calendarEvents, ({ one }) => ({
  client: one(clients, { fields: [calendarEvents.clientId], references: [clients.id] }),
}));
