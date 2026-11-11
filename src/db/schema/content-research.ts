import { relations, sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import {
  contentIdeaCategoryEnum,
  contentIdeaEffortEnum,
  contentIdeaStatusEnum,
  contentResearchRunStatusEnum,
} from "./enums";
import { clients } from "./clients";
import { users } from "./identity";
import { scripts } from "./production";

/* ------------------------------------------------------------------ *
 * AI Content Research — continu, per klant, échte trend-/concurrent-
 * onderzoek dat originele organische video-ideeën oplevert. Staat los
 * van AI Video Intelligence (die gepubliceerde video's analyseert).
 *
 * `contentResearchRuns`  = één onderzoeksronde (web-onderzoek → ideeën),
 *                          met statuslevenscyclus zodat de UI de echte
 *                          voortgang toont en het onderzoek navigatie
 *                          overleeft.
 * `contentIdeas`         = de losse ideeën (blijven bewaard tussen rondes).
 * `contentResearchProfiles` = "Content DNA" per klant (auto + handmatig).
 * `contentChat*`         = klantspecifieke "Spar met AI"-gesprekken.
 * ------------------------------------------------------------------ */

export const contentResearchRuns = pgTable(
  "content_research_runs",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: contentResearchRunStatusEnum("status").notNull().default("bezig"),
    /** Grove fase voor de voortgangsweergave: zoeken | ideeen | opslaan | klaar. */
    phase: varchar("phase", { length: 20 }).notNull().default("zoeken"),
    /** Korte samenvatting van de gevonden trends (vrije tekst). */
    summary: text("summary"),
    /** Gevonden trends/observaties: string[]. */
    trends: jsonb("trends").notNull().default(sql`'[]'::jsonb`),
    /** Echte bronnen met klikbare links: { label, url }[]. */
    sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
    /** Totaal aantal ideeën dat deze ronde opleverde. */
    ideasCount: integer("ideas_count").notNull().default(0),
    /** Aantal nieuwe (niet-duplicaat) ideeën uit deze ronde. */
    newCount: integer("new_count").notNull().default(0),
    /**
     * Strategisch advies o.b.v. de echte resultaten/maandrapportages:
     * { kleur: 'doorgaan'|'verbeteren'|'vermijden', punt, bewijs, zekerheid }[].
     */
    strategicAdvice: jsonb("strategic_advice").notNull().default(sql`'[]'::jsonb`),
    /** Laatste foutmelding (bij status 'mislukt'). */
    errorMessage: text("error_message"),
    /** Wie deze ronde startte (null = automatisch/cron). */
    triggeredById: uuid("triggered_by_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("content_research_runs_client_idx").on(t.clientId, t.status)],
);

export const contentIdeas = pgTable(
  "content_ideas",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** De onderzoeksronde waaruit dit idee komt (null = via de chat opgeslagen). */
    runId: uuid("run_id").references(() => contentResearchRuns.id, { onDelete: "set null" }),
    titel: varchar("titel", { length: 240 }).notNull(),
    concept: text("concept").notNull().default(""),
    /** Minimaal twee mogelijke openingszinnen: string[]. */
    hooks: jsonb("hooks").notNull().default(sql`'[]'::jsonb`),
    waaromWerkt: text("waarom_werkt"),
    /** Waartoe dit idee dient — het doel voor de klant (bekendheid, vertrouwen, aanvragen …). */
    doel: text("doel"),
    /** Echte inspiratiebron (indien beschikbaar). */
    inspiratieUrl: text("inspiratie_url"),
    inspiratieLabel: varchar("inspiratie_label", { length: 240 }),
    categorie: contentIdeaCategoryEnum("categorie").notNull().default("overig"),
    uitvoerbaarheid: contentIdeaEffortEnum("uitvoerbaarheid").notNull().default("gemiddeld"),
    /** Interne AI-kwaliteitsinschatting 1–10 (géén view-garantie). */
    score: integer("score").notNull().default(0),
    scoreReason: text("score_reason"),
    status: contentIdeaStatusEnum("status").notNull().default("nieuw"),
    /** Reden bij afwijzing — hiervan leert het Content DNA. */
    rejectionReason: text("rejection_reason"),
    /** Gekoppeld script na "Maak script". */
    forwardedScriptId: uuid("forwarded_script_id").references(() => scripts.id, { onDelete: "set null" }),
    /** Genormaliseerd concept voor duplicaatdetectie tussen rondes. */
    dedupeHash: varchar("dedupe_hash", { length: 64 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("content_ideas_client_idx").on(t.clientId, t.status),
    index("content_ideas_run_idx").on(t.runId),
  ],
);

export const contentResearchProfiles = pgTable(
  "content_research_profiles",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /**
     * Content DNA: { toneOfVoice, doelgroep, favorieteFormats[],
     * geaccepteerdeConcepten[], afgekeurdeConcepten[], voorkeuren[],
     * creatieveBeperkingen[], gewensteUitstraling }.
     */
    profile: jsonb("profile").notNull().default(sql`'{}'::jsonb`),
    /** Automatisch opgebouwde samenvatting (uit onderzoek/feedback). */
    autoSummary: text("auto_summary"),
    /** Handmatige aantekeningen van het team (blijven behouden). */
    manualNotes: text("manual_notes"),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [unique("content_research_profiles_client_unique").on(t.clientId)],
);

export const contentChatConversations = pgTable(
  "content_chat_conversations",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull().default("Nieuw gesprek"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("content_chat_conv_client_idx").on(t.clientId)],
);

export const contentChatMessages = pgTable(
  "content_chat_messages",
  {
    id: pk(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => contentChatConversations.id, { onDelete: "cascade" }),
    /** 'user' | 'assistant' */
    role: varchar("role", { length: 12 }).notNull(),
    content: text("content").notNull(),
    ...timestamps,
  },
  (t) => [index("content_chat_msg_conv_idx").on(t.conversationId)],
);

export const contentResearchRunsRelations = relations(contentResearchRuns, ({ one, many }) => ({
  client: one(clients, { fields: [contentResearchRuns.clientId], references: [clients.id] }),
  triggeredBy: one(users, { fields: [contentResearchRuns.triggeredById], references: [users.id] }),
  ideas: many(contentIdeas),
}));

export const contentIdeasRelations = relations(contentIdeas, ({ one }) => ({
  client: one(clients, { fields: [contentIdeas.clientId], references: [clients.id] }),
  run: one(contentResearchRuns, { fields: [contentIdeas.runId], references: [contentResearchRuns.id] }),
  forwardedScript: one(scripts, { fields: [contentIdeas.forwardedScriptId], references: [scripts.id] }),
}));

export const contentResearchProfilesRelations = relations(contentResearchProfiles, ({ one }) => ({
  client: one(clients, { fields: [contentResearchProfiles.clientId], references: [clients.id] }),
}));

export const contentChatConversationsRelations = relations(contentChatConversations, ({ one, many }) => ({
  client: one(clients, { fields: [contentChatConversations.clientId], references: [clients.id] }),
  messages: many(contentChatMessages),
}));

export const contentChatMessagesRelations = relations(contentChatMessages, ({ one }) => ({
  conversation: one(contentChatConversations, {
    fields: [contentChatMessages.conversationId],
    references: [contentChatConversations.id],
  }),
}));
