import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Kwartaalrapportages
 *
 * Eigen tabellen naast de maandrapportages (client_reports), zodat de
 * maandflow ongewijzigd blijft. De cijfers komen uit dezelfde bronnen
 * (daily_metrics, social_metrics, publications, production_days,
 * deliverables, scripts); hier staat alleen de rapportage zelf.
 * ------------------------------------------------------------------ */

/** Instelling per klant: kalender- of contractkwartalen, en de doelen per kwartaal. */
export const clientQuarterSettings = pgTable("client_quarter_settings", {
  clientId: uuid("client_id").primaryKey().references(() => clients.id, { onDelete: "cascade" }),
  /** kalender | contract */
  mode: varchar("mode", { length: 12 }).notNull().default("kalender"),
  /** Kwartaalrapportage aan of uit voor deze klant. */
  enabled: boolean("enabled").notNull().default(true),
  /** Doelen per kwartaal: { "<periodKey>": [{ id, label, metric, target }] }. */
  doelen: jsonb("doelen").notNull().default(sql`'{}'::jsonb`),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

export const quarterlyReports = pgTable(
  "quarterly_reports",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    /** kalender | contract */
    periodMode: varchar("period_mode", { length: 12 }).notNull().default("kalender"),
    /** "2026-Q4" of "C2026-02-15". */
    periodKey: varchar("period_key", { length: 16 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    /** Zie QUARTER_STATUSES in @/lib/kwartaal. */
    status: varchar("status", { length: 24 }).notNull().default("gepland"),
    /** True zolang de cijfers niet het volledige kwartaal beslaan. */
    voorlopig: boolean("voorlopig").notNull().default(true),
    /** Aangevraagde generatie voor de wachtrij: voorlopig | definitief. */
    queued: varchar("queued", { length: 12 }),
    /** organisch | advertentie | beide | onbekend (vastgelegd bij de generatie). */
    pakketType: varchar("pakket_type", { length: 12 }).notNull().default("onbekend"),
    /** In code berekende cijfers, met bron en meetperiode. */
    metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
    /** Inhoud van de klantversie (onderdelen A t/m J). */
    klant: jsonb("klant").notNull().default(sql`'{}'::jsonb`),
    /** Interne verdieping. Komt nooit in het klantportaal of de klant-PDF. */
    intern: jsonb("intern").notNull().default(sql`'{}'::jsonb`),
    ontbrekend: jsonb("ontbrekend").notNull().default(sql`'[]'::jsonb`),
    /** Waarom de rapportage nog niet gereed is (zichtbaar voor de verantwoordelijke). */
    wachtReden: text("wacht_reden"),
    /** Openstaande opmerkingen van de controleur: [{ id, body, byName, at }]. */
    openFeedback: jsonb("open_feedback").notNull().default(sql`'[]'::jsonb`),
    /** Laatste versienummer (elke generatie, goedkeuring en publicatie is een versie). */
    versionNumber: integer("version_number").notNull().default(0),
    /** De versie die in het klantportaal staat. Leeg = niet gepubliceerd. */
    publishedVersion: integer("published_version"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedById: uuid("published_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Controle afgerond door de verantwoordelijke (aangeboden ter goedkeuring). */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedVersion: integer("approved_version"),
    /** Bewust afgerond met onvolledige data (expliciete keuze van een medewerker). */
    dataOverrideAt: timestamp("data_override_at", { withTimezone: true }),
    dataOverrideById: uuid("data_override_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Start van de lopende generatie (voorkomt dubbel draaien). */
    startedAt: timestamp("started_at", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    /** Lessen zijn na goedkeuring vastgelegd in het Contentgeheugen. */
    lessonsSavedAt: timestamp("lessons_saved_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("quarterly_reports_unique").on(t.clientId, t.periodKey),
    index("quarterly_reports_status_idx").on(t.status),
    index("quarterly_reports_period_idx").on(t.periodEnd),
  ],
);

/** Bevroren momentopname per generatie, goedkeuring en publicatie. */
export const quarterlyReportVersions = pgTable(
  "quarterly_report_versions",
  {
    id: pk(),
    reportId: uuid("report_id").notNull().references(() => quarterlyReports.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    /** generatie | goedkeuring | publicatie | herpublicatie */
    kind: varchar("kind", { length: 16 }).notNull(),
    /** { title, periodKey, periodStart, periodEnd, pakketType, voorlopig, metrics, klant, intern, ontbrekend }. */
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    byId: uuid("by_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [unique("quarterly_report_versions_unique").on(t.reportId, t.versionNumber)],
);

/** Auditgeschiedenis per rapportage: wie deed wat en wanneer (ook het systeem). */
export const quarterlyReportEvents = pgTable(
  "quarterly_report_events",
  {
    id: pk(),
    reportId: uuid("report_id").notNull().references(() => quarterlyReports.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 }).notNull(),
    fromStatus: varchar("from_status", { length: 24 }),
    toStatus: varchar("to_status", { length: 24 }),
    /** Leeg = automatisch door het systeem. */
    byId: uuid("by_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("quarterly_report_events_report_idx").on(t.reportId, t.createdAt)],
);

/** Lessen uit een goedgekeurde kwartaalrapportage, voor Contentgeheugen en Scripting. */
export const quarterlyLessons = pgTable(
  "quarterly_lessons",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull().references(() => quarterlyReports.id, { onDelete: "cascade" }),
    periodKey: varchar("period_key", { length: 16 }).notNull(),
    periodLabel: varchar("period_label", { length: 80 }).notNull(),
    /** vaker | minder | les | hook | format | doelgroep */
    kind: varchar("kind", { length: 16 }).notNull(),
    text: text("text").notNull(),
    /** bewezen | waarschijnlijk | hypothese */
    zekerheid: varchar("zekerheid", { length: 16 }).notNull().default("hypothese"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("quarterly_lessons_client_idx").on(t.clientId, t.createdAt)],
);

/** Verbeterpunten uit een goedgekeurde rapportage, opgevolgd in het volgende kwartaal. */
export const quarterlyImprovements = pgTable(
  "quarterly_improvements",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull().references(() => quarterlyReports.id, { onDelete: "cascade" }),
    periodKey: varchar("period_key", { length: 16 }).notNull(),
    position: integer("position").notNull().default(0),
    titel: varchar("titel", { length: 240 }).notNull(),
    actie: text("actie").notNull().default(""),
    verantwoordelijke: varchar("verantwoordelijke", { length: 120 }),
    /** open | uitgevoerd | vervallen */
    status: varchar("status", { length: 12 }).notNull().default("open"),
    taskId: uuid("task_id"),
    note: text("note"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneById: uuid("done_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("quarterly_improvements_client_idx").on(t.clientId, t.periodKey), index("quarterly_improvements_report_idx").on(t.reportId)],
);
