import { index, pgTable, text, timestamp, varchar, uuid } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * AI CEO Mentor — privé voor de eigenaar.
 * Gesprekken + berichten (persoonlijk geheugen/kennisbank volgen in latere fases).
 * ------------------------------------------------------------------ */

export const mentorConversations = pgTable(
  "mentor_conversations",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull().default("Nieuw gesprek"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("mentor_conv_user_idx").on(t.userId)],
);

export const mentorMessages = pgTable(
  "mentor_messages",
  {
    id: pk(),
    conversationId: uuid("conversation_id").notNull().references(() => mentorConversations.id, { onDelete: "cascade" }),
    /** 'user' | 'assistant' */
    role: varchar("role", { length: 12 }).notNull(),
    content: text("content").notNull(),
    ...timestamps,
  },
  (t) => [index("mentor_msg_conv_idx").on(t.conversationId)],
);
