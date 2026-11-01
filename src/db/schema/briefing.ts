import { relations, sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { briefingSetStatusEnum } from "./enums";
import { clients } from "./clients";
import { productionDays } from "./production";

/* ------------------------------------------------------------------ *
 * Automatische editor-briefing per opnamesessie.
 *
 * Eén compacte briefing per opname (productionDay), automatisch gegenereerd uit
 * de scriptcontrole-PDF. `sourceHash` (sha256 van de verwerkte PDF) voorkomt
 * dubbele AI-aanroepen; bij een gewijzigd script wordt de briefing opnieuw
 * gegenereerd. `content` = het compacte EditorBriefing-JSON.
 * ------------------------------------------------------------------ */

export const briefingSets = pgTable(
  "briefing_sets",
  {
    id: pk(),
    productionDayId: uuid("production_day_id")
      .notNull()
      .references(() => productionDays.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: briefingSetStatusEnum("status").notNull().default("bezig"),
    /** Welke scriptcontrole-PDF-versie verwerkt is (script_review_versions.id). */
    sourceReviewVersionId: uuid("source_review_version_id"),
    /** sha256 van de verwerkte PDF-bytes — wijzigingsdetectie. */
    sourceHash: varchar("source_hash", { length: 64 }),
    /** De compacte briefing (EditorBriefing: projectIntro + shorts[]). */
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    /** Start van de huidige generatie — guard tegen dubbel draaien. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("briefing_sets_production_day_unique").on(t.productionDayId),
    index("briefing_sets_client_idx").on(t.clientId, t.status),
  ],
);

export const briefingSetsRelations = relations(briefingSets, ({ one }) => ({
  productionDay: one(productionDays, { fields: [briefingSets.productionDayId], references: [productionDays.id] }),
  client: one(clients, { fields: [briefingSets.clientId], references: [clients.id] }),
}));
