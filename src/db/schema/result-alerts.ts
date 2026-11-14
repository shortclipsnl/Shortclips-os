import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Klanten die aandacht nodig hebben (Resultatenpagina)
 * ------------------------------------------------------------------ */

/**
 * Eén alert per klant per soort (negatief = rood/oranje, positief = groen).
 * De analyse draait dagelijks (src/server/result-alerts.ts); deze tabel bewaart
 * de uitkomst plus wat het team ermee doet, zodat dezelfde situatie nooit een
 * tweede alert of tweede taak oplevert.
 *
 * Status:
 *  - open        nieuw, nog niet opgepakt
 *  - actie       er is een taak aangemaakt (task_id)
 *  - opgelost    afgehandeld na een verbeteractie; effectmeting loopt
 *  - afgehandeld bewust afgehandeld zonder actie
 *  - vervallen   het signaal verdween vanzelf voordat iemand het oppakte
 */
export const resultAlerts = pgTable(
  "result_alerts",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    /** negatief | positief */
    kind: varchar("kind", { length: 12 }).notNull(),
    /** rood | oranje | groen */
    level: varchar("level", { length: 8 }).notNull(),
    status: varchar("status", { length: 12 }).notNull().default("open"),
    headline: varchar("headline", { length: 200 }).notNull(),
    /** { findings, causes, advice, actions, memory } (zie src/lib/result-alerts.ts) */
    analysis: jsonb("analysis").notNull().default(sql`'{}'::jsonb`),
    /** Platforms waar het signaal speelt. */
    platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
    /** Niveau tijdens het probleem, voor de effectmeting. */
    snapshot: jsonb("snapshot").notNull().default(sql`'{}'::jsonb`),
    /** Verantwoordelijke (standaard de coördinator van de klant). */
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    taskId: uuid("task_id"),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).notNull().defaultNow(),
    lastDetectedAt: timestamp("last_detected_at", { withTimezone: true }).notNull().defaultNow(),
    /** Moment vanaf wanneer nieuwe video's als "na de actie" tellen. */
    actionAt: timestamp("action_at", { withTimezone: true }),
    actionText: text("action_text"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
    resolutionNote: text("resolution_note"),
    /** Uitkomst van de effectmeting (src/lib/result-alerts.ts → Effect). */
    effect: jsonb("effect"),
    /** Laatste melding aan de verantwoordelijke (tegen herhaalde meldingen). */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** Hoogste niveau waarover gemeld is, zodat alleen een escalatie opnieuw meldt. */
    notifiedLevel: varchar("notified_level", { length: 8 }),
    ...timestamps,
  },
  (t) => [
    /** Eén lopende alert per klant per soort: dubbel kan niet. */
    uniqueIndex("result_alerts_active_unique")
      .on(t.clientId, t.kind)
      .where(sql`${t.status} in ('open','actie')`),
    index("result_alerts_status_idx").on(t.status, t.level),
    index("result_alerts_client_idx").on(t.clientId, t.firstDetectedAt),
  ],
);
