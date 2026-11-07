import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";
import { tasks } from "./production";

/* ------------------------------------------------------------------ *
 * Operationele controle (09:00 en 15:00)
 * ------------------------------------------------------------------ */

/**
 * Eén rij per gecontroleerd probleem ("punt"). De controle bepaalt elke run
 * opnieuw welke problemen in de bronnen bestaan (video's, scripts, opnames,
 * taken). Een punt blijft open zolang de bron het probleem laat zien en wordt
 * automatisch afgesloten zodra dat niet meer zo is. De zichtbare kant is een
 * gewone taak op de takenpagina (`taskId`); deze tabel is het geheugen erachter:
 * sinds wanneer, wie, escalatie en hoe het is afgesloten.
 *
 * `itemKey` is stabiel per soort probleem per klant (bijv.
 * `editing:eerste-versie-verwacht:<clientId>`), zodat er nooit twee punten of
 * twee taken voor hetzelfde ontstaan.
 */
export const opsControlItems = pgTable(
  "ops_control_items",
  {
    id: pk(),
    itemKey: varchar("item_key", { length: 200 }).notNull(),
    /** scripting | editing | klantfeedback | klantcommunicatie | opname | taken */
    domain: varchar("domain", { length: 24 }).notNull(),
    category: varchar("category", { length: 60 }).notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    clientLabel: varchar("client_label", { length: 160 }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 200 }).notNull(),
    reason: text("reason"),
    href: varchar("href", { length: 300 }),
    /** hoog = vandaag, normaal = binnen 2 werkdagen. */
    priority: varchar("priority", { length: 10 }).notNull().default("normaal"),
    /** rood | oranje */
    severity: varchar("severity", { length: 10 }).notNull().default("oranje"),
    dueOn: date("due_on"),
    /** open | resolved */
    status: varchar("status", { length: 12 }).notNull().default("open"),
    /**
     * Hoe een punt is afgesloten:
     *  - auto: de bron laat het probleem niet meer zien (daadwerkelijk opgelost);
     *  - manual: handmatig afgerond, niet automatisch te controleren;
     */
    resolution: varchar("resolution", { length: 12 }),
    /** true = de bron bevestigt of het echt is opgelost (handmatig afvinken telt niet). */
    verifiable: boolean("verifiable").notNull().default(true),
    /** Gekoppelde taak op de takenpagina. */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** Taak handmatig afgerond terwijl de bron het probleem nog liet zien. */
    manualDoneCount: integer("manual_done_count").notNull().default(0),
    /** Handmatig afgerond (niet verifieerbaar): pas na deze datum weer melden. */
    snoozedUntil: date("snoozed_until"),
    /** 0 = medewerker, 1 = operationeel verantwoordelijke, 2 = Jarno. */
    escalationLevel: integer("escalation_level").notNull().default(0),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    escalatedToId: uuid("escalated_to_id").references(() => users.id, { onDelete: "set null" }),
    jarnoNotifiedAt: timestamp("jarno_notified_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(sql`now()`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(sql`now()`),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("ops_control_items_key_unique").on(t.itemKey),
    index("ops_control_items_owner_idx").on(t.ownerId, t.status),
    index("ops_control_items_status_idx").on(t.status, t.domain),
  ],
);

export type OpsDomainHealth = {
  domain: string;
  /** checked = volledig gecontroleerd; partial = deels; unavailable = bron niet bereikbaar. */
  check: "checked" | "partial" | "unavailable";
  note?: string;
};

export type OpsRunSummary = {
  domains: OpsDomainHealth[];
  open: number;
  created: number;
  updated: number;
  resolvedAuto: number;
  reopened: number;
  escalated: number;
  notified: number;
  errors: string[];
};

/** Eén rij per controlemoment, zodat "laatste controle" en dubbele runs te bewaken zijn. */
export const opsControlRuns = pgTable(
  "ops_control_runs",
  {
    id: pk(),
    runDate: date("run_date").notNull(),
    /** ochtend | middag | handmatig */
    slot: varchar("slot", { length: 12 }).notNull(),
    status: varchar("status", { length: 12 }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    summary: jsonb("summary").$type<OpsRunSummary>(),
    triggeredById: uuid("triggered_by_id").references(() => users.id, { onDelete: "set null" }),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    // Elk vast controlemoment maximaal één keer per dag (handmatig mag vaker).
    uniqueIndex("ops_control_runs_slot_unique").on(t.runDate, t.slot).where(sql`${t.slot} <> 'handmatig'`),
    index("ops_control_runs_started_idx").on(t.startedAt),
  ],
);
