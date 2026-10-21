import { boolean, index, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { users } from "./identity";
import { deliverables } from "./video";

/* ------------------------------------------------------------------ *
 * Showcase — awards voor editors op basis van opgeleverde shorts.
 *
 * Awards worden vastgelegd op het moment van behalen (append-only): een
 * behaalde award blijft staan, ook als een video later wordt afgekeurd of
 * opnieuw wordt toegewezen. De teller zelf wordt live uit de opgeleverde
 * video's berekend. Zie src/server/awards/*.
 * ------------------------------------------------------------------ */

/** Eén behaalde award voor één editor. */
export const editorAwards = pgTable(
  "editor_awards",
  {
    id: pk(),
    /** De editor (gebruiker) die de award haalde. */
    editorId: uuid("editor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Sleutel uit de awards-config (bijv. "century"). */
    awardKey: varchar("award_key", { length: 40 }).notNull(),
    /** Goedkeuringsdatum van de video die de drempel haalde. */
    achievedAt: timestamp("achieved_at", { withTimezone: true }).notNull(),
    /** De video waarmee de drempel werd gehaald (mag later verdwijnen). */
    videoId: uuid("video_id").references(() => deliverables.id, { onDelete: "set null" }),
    /** Wanneer de editor de viering heeft geopend (null = nog niet gevierd). */
    celebratedAt: timestamp("celebrated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Een award kan maar één keer per editor behaald worden.
    unique("editor_awards_unique").on(t.editorId, t.awardKey),
    index("editor_awards_editor_idx").on(t.editorId),
  ],
);

/** Voorkeuren per editor voor de Showcase. */
export const editorPreferences = pgTable("editor_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  /** Of de Showcase zichtbaar is voor deze editor (standaard aan). */
  showcaseEnabled: boolean("showcase_enabled").notNull().default(true),
  /** Geluid bij het behalen van een award (standaard aan). */
  awardSound: boolean("award_sound").notNull().default(true),
  ...timestamps,
});
