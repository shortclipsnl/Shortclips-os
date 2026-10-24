import { date, index, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, softDelete, timestamps } from "./_shared";
import { users } from "./identity";
import { kbCourses, kbLessons } from "./kennisbank";

/**
 * Persoonlijke ontwikkelpunten per medewerker. Bewust met varchar-statusvelden
 * i.p.v. pg-enums, zodat waarden toegevoegd kunnen worden zonder zware migraties.
 *
 * Onderscheid in `type` (cruciaal, zie opdracht):
 *   fout        = een daadwerkelijke, herhaalde fout (bv. veel interne revisies)
 *   vaardigheid = een te ontwikkelen vaardigheid/groeipunt
 *   feedback    = persoonlijke feedback/gedrag (samenwerking, communicatie)
 * Klantvoorkeuren worden NOOIT als fout van de medewerker vastgelegd.
 *
 * zekerheid:  bewezen | waarschijnlijk | hypothese  (eerlijkheid over databasis)
 * status:     open | in_progress | resolved | dismissed
 * source:     ai | manual | automation
 */
export const developmentPoints = pgTable(
  "development_points",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 16 }).notNull().default("vaardigheid"),
    /** Vrij thema-label, bv. kwaliteit | deadlines | feedback | techniek | samenwerking. */
    category: varchar("category", { length: 40 }).notNull().default("kwaliteit"),
    title: varchar("title", { length: 240 }).notNull(),
    /** Wat + waarom (onderbouwd met de cijfers). */
    description: text("description").notNull().default(""),
    /** Concreet advies / aanbeveling om te verbeteren. */
    advies: text("advies").notNull().default(""),
    zekerheid: varchar("zekerheid", { length: 16 }).notNull().default("waarschijnlijk"),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    source: varchar("source", { length: 12 }).notNull().default("ai"),
    /** De cijfers/signalen waarop dit punt rust (sampleSize, metrics, bron). */
    evidence: jsonb("evidence").notNull().default(sql`'{}'::jsonb`),
    /** Gekoppelde training uit de interne kennisbank. */
    kbCourseId: uuid("kb_course_id").references(() => kbCourses.id, { onDelete: "set null" }),
    kbLessonId: uuid("kb_lesson_id").references(() => kbLessons.id, { onDelete: "set null" }),
    /** Leidinggevende die dit punt beoordeelde/aanpaste. */
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Dedup-sleutel voor AI-/automatische punten: ai:<userId>:<thema>. */
    dedupeKey: varchar("dedupe_key", { length: 180 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("development_points_user_idx").on(t.userId, t.status),
    index("development_points_dedupe_idx").on(t.dedupeKey),
  ],
);

/**
 * Nachtelijke momentopname van de kerncijfers per medewerker, voor het verloop
 * ("boekt iemand vooruitgang, komen eerdere fouten minder vaak voor?").
 * Eén rij per medewerker per dag.
 */
export const developmentSnapshots = pgTable(
  "development_snapshots",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    snapshotOn: date("snapshot_on").notNull(),
    /** { opgeleverd, internalCorrectionRate, onTimeRate, gemIntern, gemKlant,
     *    openFouten, openPunten, resolvedPunten, deadlineMissesOpen, lessonsDone } */
    metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [unique("development_snapshots_unique").on(t.userId, t.snapshotOn)],
);
