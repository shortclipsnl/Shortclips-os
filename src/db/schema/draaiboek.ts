import { relations, sql } from "drizzle-orm";
import { customType, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";
import { productionDays } from "./production";

/* ------------------------------------------------------------------ *
 * Videograaf draaiboek per opnamesessie.
 *
 * Eén draaiboek per opname (productionDay), automatisch opgebouwd uit de
 * script-PDF van die sessie (dezelfde bron als de editorbriefing). De teksten
 * komen letterlijk uit het script; het team kan ze in de controlestap aanpassen.
 * Pas na "Goedkeuren en versturen" ziet de videograaf het draaiboek.
 *
 * status: concept → verstuurd → afgerond | afgerond_open
 * content: DraaiboekContent (zie src/server/draaiboek/types.ts)
 * progress: { [videoKey]: { hook?: true, middenstuk?: true, cta?: true, broll?: true } }
 * ------------------------------------------------------------------ */

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});

export const draaiboeken = pgTable(
  "draaiboeken",
  {
    id: pk(),
    productionDayId: uuid("production_day_id")
      .notNull()
      .references(() => productionDays.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).notNull().default("concept"),
    /** sha256 van de verwerkte script-PDF: zien wanneer het script is vervangen. */
    sourceHash: varchar("source_hash", { length: 64 }),
    sourceFileName: text("source_file_name"),
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    progress: jsonb("progress").notNull().default(sql`'{}'::jsonb`),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    /** Videograaf naar wie het draaiboek is verstuurd. */
    sentToId: uuid("sent_to_id").references(() => users.id, { onDelete: "set null" }),
    sentById: uuid("sent_by_id").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    finishNote: text("finish_note"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("draaiboeken_production_day_unique").on(t.productionDayId),
    index("draaiboeken_sent_to_idx").on(t.sentToId, t.status),
  ],
);

/** Notities van de videograaf per video: getypt of ingesproken (audio blijft bewaard). */
export const draaiboekNotes = pgTable(
  "draaiboek_notes",
  {
    id: pk(),
    draaiboekId: uuid("draaiboek_id")
      .notNull()
      .references(() => draaiboeken.id, { onDelete: "cascade" }),
    videoKey: varchar("video_key", { length: 40 }).notNull(),
    /** notitie | blokkade */
    kind: varchar("kind", { length: 16 }).notNull().default("notitie"),
    /** Getypte tekst of de uitgeschreven spraak (kan leeg zijn). */
    text: text("text"),
    /** Korte samenvatting, alleen als die iets toevoegt aan een lange spraaknotitie. */
    summary: text("summary"),
    audio: bytea("audio"),
    audioMime: varchar("audio_mime", { length: 60 }),
    durationSec: integer("duration_sec"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("draaiboek_notes_draaiboek_idx").on(t.draaiboekId, t.videoKey)],
);

export const draaiboekenRelations = relations(draaiboeken, ({ one, many }) => ({
  productionDay: one(productionDays, { fields: [draaiboeken.productionDayId], references: [productionDays.id] }),
  client: one(clients, { fields: [draaiboeken.clientId], references: [clients.id] }),
  notes: many(draaiboekNotes),
}));

export const draaiboekNotesRelations = relations(draaiboekNotes, ({ one }) => ({
  draaiboek: one(draaiboeken, { fields: [draaiboekNotes.draaiboekId], references: [draaiboeken.id] }),
}));
