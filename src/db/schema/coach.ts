import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Coach (alleen eigenaar): dagelijkse ochtend- en avondcontrole en het
 * wekelijkse ondernemersrapport. Eén JSON-document per pad:
 *  - "dag/JJJJ-MM-DD"  ochtend (3 acties), avond (scores, eigen input), status
 *  - "week/JJJJ-wNN"   salescijfers per laag, rapport, prioriteiten
 */
export const coachDocs = pgTable("coach_docs", {
  path: text("path").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
