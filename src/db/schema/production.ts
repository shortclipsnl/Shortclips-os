import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
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
    scriptingStatus: varchar("scripting_status", { length: 24 }).notNull().default("concepting"),
    /** Vrije notitie bij de scriptingstatus: wat er nog moet gebeuren, zodat het
     *  team context heeft naast de korte status (bijv. "wacht op beeld klant"). */
    scriptingNote: text("scripting_note"),
    /** Verantwoordelijke die het script voor deze opname schrijft
     *  (Milou/Jiska/Jarno). Zo is er geen onduidelijkheid wie het oppakt. */
    scriptWriterId: uuid("script_writer_id").references(() => users.id, {
      onDelete: "set null",
    }),
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
    /* --- Editing: deze opname is tegelijk het edit-project voor één editor. --- */
    /** Editor die de beelden van deze opname monteert. */
    editorId: uuid("editor_id").references(() => users.id, { onDelete: "set null" }),
    /** Editingfase van het project, handmatig of afgeleid: te_plannen → in_edit →
     *  interne_controle → bij_klant → feedback_verwerken → afgerond. */
    editStatus: varchar("edit_status", { length: 24 }).notNull().default("te_plannen"),
    /** Aantal shorts dat uit deze opname moet komen (planning). */
    plannedShorts: integer("planned_shorts"),
    /** Handmatige oplevering-deadline. Leeg = automatisch (opname + 14 werkdagen
     *  uit de agenda); ingevuld = overschrijft die. */
    editDueOn: date("edit_due_on"),
    /** Download-link met het ruwe beeldmateriaal voor de editor. */
    footageUrl: text("footage_url"),
    /** Link naar het script (bijv. een PDF in Drive) voor de editor. */
    scriptUrl: text("script_url"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("production_days_client_idx").on(t.clientId, t.scheduledOn),
    index("production_days_date_idx").on(t.scheduledOn),
    index("production_days_videographer_idx").on(t.videographerId),
    index("production_days_editor_idx").on(t.editorId),
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

/** Geüploade bestanden bij een edit-project (nu: het script als PDF). Klein
 *  genoeg om als base64 in de database te bewaren — werkt lokaal én in productie
 *  zonder externe opslag. */
export const editProjectFiles = pgTable(
  "edit_project_files",
  {
    id: pk(),
    productionDayId: uuid("production_day_id")
      .notNull()
      .references(() => productionDays.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull().default("script"),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Kleine bestanden: base64 in de database. Grotere PDF's gaan via Supabase
    // Storage (langs de 4,5MB-requestlimiet van Vercel) — dan staat hier de
    // opslagsleutel i.p.v. base64. Precies één van beide is gevuld.
    dataBase64: text("data_base64"),
    storagePath: text("storage_path"),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [index("edit_project_files_day_idx").on(t.productionDayId, t.kind)],
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
    /** Soort taak voor de groepering op de takenpagina: `scripting`,
     *  `klantcontact` of `overig`. Zo staat niet alles in één lange lijst. */
    category: varchar("category", { length: 24 }).notNull().default("overig"),
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
    /** `manual` of `automation` — onderscheidt handwerk van automatische taken. */
    source: varchar("source", { length: 16 }).notNull().default("manual"),
    /** Unieke sleutel regel:entiteit:periode, zodat eenzelfde automatische taak
     *  nooit dubbel wordt aangemaakt (alleen uniek zolang de taak open is). */
    dedupeKey: varchar("dedupe_key", { length: 200 }),
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
    // Partiële unieke index: één open automatische taak per dedupe-sleutel.
    uniqueIndex("tasks_dedupe_open_unique")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} <> 'done' and ${t.deletedAt} is null`),
  ],
);

/**
 * Overdrachtspunten voor het kantoorteam (Milou & Jiska): korte notities voor de
 * volgende persoon/dag. Bijv. "Klant X gebeld, moet nog teruggebeld worden." Een
 * notitie kan op "gedaan" worden gezet zodra de volgende persoon het heeft
 * opgepakt. Gedeeld zichtbaar voor het interne kernteam.
 */
export const handoverNotes = pgTable(
  "handover_notes",
  {
    id: pk(),
    /** Wie de notitie schreef. */
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    /** Optioneel: voor wie de overdracht bedoeld is (anders: iedereen). */
    forUserId: uuid("for_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** Gezet wanneer de overdracht is opgepakt/afgehandeld. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("handover_notes_open_idx").on(t.resolvedAt, t.createdAt)],
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

/* ------------------------------------------------------------------ *
 * Gekoppelde agenda's — welke Google-agenda's we synchroniseren.
 * Owner-beheerd (Beheer → Agenda's). Vervangt de env-lijst zodra er
 * rijen staan; elke agenda krijgt een eigen kleur voor de weergave.
 * ------------------------------------------------------------------ */

export const calendarCouplings = pgTable(
  "calendar_couplings",
  {
    id: pk(),
    calendarId: varchar("calendar_id", { length: 320 }).notNull(),
    label: varchar("label", { length: 200 }),
    color: varchar("color", { length: 16 }).notNull().default("#2E90FA"),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [unique("calendar_couplings_calendar_id_unique").on(t.calendarId)],
);

/* ------------------------------------------------------------------ *
 * Teamcapaciteit — eigen vervanger van het Monday-capaciteitsdashboard.
 * Per persoon een capaciteit in de juiste eenheid (opnames/4wk, shorts/4wk
 * of CC-uren/maand) met grenzen; de belasting wordt native berekend uit
 * opnamedagen, editwerk en verlof. capacity_params houdt de globale aannames
 * (groeisimulator, personeelsadvies, economie).
 * ------------------------------------------------------------------ */

export const capacityPeople = pgTable(
  "capacity_people",
  {
    id: pk(),
    /** Gekoppelde gebruiker, als die bestaat (anders alleen op naam/alias). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 120 }).notNull(),
    /** Komma-gescheiden namen zoals ze in labels/agenda voorkomen (voor matching). */
    aliases: varchar("aliases", { length: 300 }),
    employment: varchar("employment", { length: 16 }), // vast | freelance
    role: varchar("role", { length: 24 }), // Content Creative | Videograaf | Editor | Founder
    /** Capaciteitseenheid: opnames_4w | shorts_4w | cc_uren_maand | niet_gemeten. */
    unit: varchar("unit", { length: 20 }).notNull().default("niet_gemeten"),
    workdaysPerWeek: numeric("workdays_per_week", { precision: 4, scale: 1 }),
    contractHoursPerWeek: numeric("contract_hours_per_week", { precision: 5, scale: 1 }),
    productiveHoursPerMonth: numeric("productive_hours_per_month", { precision: 6, scale: 1 }),
    limitGreen: numeric("limit_green", { precision: 8, scale: 2 }),
    limitOrange: numeric("limit_orange", { precision: 8, scale: 2 }),
    limitMax: numeric("limit_max", { precision: 8, scale: 2 }),
    costPerMonth: numeric("cost_per_month", { precision: 10, scale: 2 }),
    note: text("note"),
    ...timestamps,
  },
  (t) => [unique("capacity_people_name_unique").on(t.name)],
);

export const capacityParams = pgTable(
  "capacity_params",
  {
    id: pk(),
    key: varchar("key", { length: 48 }).notNull(),
    label: varchar("label", { length: 200 }),
    value: numeric("value", { precision: 14, scale: 4 }),
    unit: varchar("unit", { length: 80 }),
    confidence: varchar("confidence", { length: 16 }), // Bevestigd | Indicatief | Onbevestigd
    ...timestamps,
  },
  (t) => [unique("capacity_params_key_unique").on(t.key)],
);
