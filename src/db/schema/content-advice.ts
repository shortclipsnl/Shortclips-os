import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Contentadvies (Contentgeheugen): voortgang en leerlus per advies
 * ------------------------------------------------------------------ */

/**
 * Eén regel per advies dat het systeem voor een klant doet. Het advies zelf
 * wordt elke keer opnieuw berekend uit de resultaten (src/server/content-memory/
 * advice.ts); deze tabel bewaart alleen wat het team ermee doet en wat het
 * opleverde, zodat het systeem leert van zijn eigen aanbevelingen.
 *
 * Status:
 *  - nog_toepassen   nieuw advies
 *  - ingepland       het team neemt het mee bij de volgende scripts of opname
 *  - uitgevoerd      er staan video's online waarin het is toegepast
 *  - resultaat       genoeg video's voor cijfers, nog geen eindoordeel
 *  - effectief       bewezen effectief (afgesloten)
 *  - niet_effectief  niet effectief gebleken (afgesloten)
 *  - vervallen       niet meer van toepassing of bewust overgeslagen (afgesloten)
 */
export const contentAdvice = pgTable(
  "content_advice",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    /** Stabiele sleutel van het advies, bijv. "meer:hook:Prijs". */
    key: varchar("key", { length: 200 }).notNull(),
    section: varchar("section", { length: 10 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    /** Momentopname van het advies (AdviceItem), zodat het leesbaar blijft na afsluiten. */
    item: jsonb("item").notNull().default(sql`'{}'::jsonb`),
    status: varchar("status", { length: 16 }).notNull().default("nog_toepassen"),
    /** Video's die na dit moment online komen tellen als "na het advies". */
    measureFrom: timestamp("measure_from", { withTimezone: true }).notNull().defaultNow(),
    /** Uitkomst van de effectmeting (AdviceOutcome). */
    outcome: jsonb("outcome"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedById: uuid("status_changed_by_id").references(() => users.id, { onDelete: "set null" }),
    /** handmatig | automatisch */
    closedReason: varchar("closed_reason", { length: 12 }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    /** Eén lopend advies per klant per sleutel. */
    uniqueIndex("content_advice_open_unique")
      .on(t.clientId, t.key)
      .where(sql`${t.status} in ('nog_toepassen','ingepland','uitgevoerd','resultaat')`),
    index("content_advice_client_idx").on(t.clientId, t.status),
  ],
);
