import { relations, sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * AI Tools — kennisbank, klantprofielen en gegenereerde output
 * ------------------------------------------------------------------ */

/**
 * Centrale Shortclips-kennisbank, bewerkbaar vanuit het dashboard. Wordt door
 * alle drie de AI Tools als context gebruikt. Categorie bijv.: branding,
 * schrijfstijl, productie, editing, communicatie, kwaliteit, escalatie.
 */
export const aiKnowledge = pgTable(
  "ai_knowledge",
  {
    id: pk(),
    category: varchar("category", { length: 48 }).notNull().default("algemeen"),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("ai_knowledge_category_idx").on(t.category)],
);

/**
 * Per-klant AI-profiel: caption-stijl, editingvoorkeuren en communicatie-
 * afspraken. Als jsonb opgeslagen zodat we het flexibel kunnen uitbreiden
 * zonder migratie. Strikt per klant gescheiden (uniek op clientId).
 */
export const clientAiProfiles = pgTable(
  "client_ai_profiles",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** { branche, doelgroep, toneOfVoice, schrijfstijl, emojiGebruik,
     *    lengteInstagram, lengteTiktok, hashtagVoorkeuren, vasteAfsluiting,
     *    contactgegevens, voorbeelden: string[] } */
    captionProfile: jsonb("caption_profile").notNull().default(sql`'{}'::jsonb`),
    /** { aandachtspunten, voorbeelden: string[] } */
    editingProfile: jsonb("editing_profile").notNull().default(sql`'{}'::jsonb`),
    /** { afspraken, voorbeelden: string[] } */
    communicationProfile: jsonb("communication_profile").notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [unique("client_ai_profiles_client_unique").on(t.clientId)],
);

/** Gegenereerde output (captions, briefings, berichten) per klant — geschiedenis. */
export const aiOutputs = pgTable(
  "ai_outputs",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** 'caption' | 'briefing' | 'message' */
    tool: varchar("tool", { length: 24 }).notNull(),
    title: varchar("title", { length: 240 }),
    /** Samengevatte invoer (bijv. bestandsnaam of eerste regels). */
    inputSummary: text("input_summary"),
    /** Het gegenereerde resultaat, toolspecifiek. */
    output: jsonb("output").notNull().default(sql`'{}'::jsonb`),
    /** Optioneel gekoppelde opnamedag — zo weet je welke captions/briefing bij
     *  welke opname horen (een opname levert ~6–8 shorts). */
    productionDayId: uuid("production_day_id"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("ai_outputs_client_idx").on(t.clientId, t.tool)],
);

/**
 * Bedrijfsonderzoek / sales-analyse per (potentiële) klant. Invoer + het
 * gestructureerde onderzoeksresultaat (jsonb) + bronlinks. Status: 'concept'
 * (nog niet onderzocht), 'klaar' (onderzoek uitgevoerd).
 */
export const salesResearch = pgTable(
  "sales_research",
  {
    id: pk(),
    /** Optioneel gekoppeld aan een bestaande klant. */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    companyName: varchar("company_name", { length: 200 }).notNull(),
    website: varchar("website", { length: 300 }),
    instagram: varchar("instagram", { length: 300 }),
    tiktok: varchar("tiktok", { length: 300 }),
    linkedin: varchar("linkedin", { length: 300 }),
    facebook: varchar("facebook", { length: 300 }),
    youtube: varchar("youtube", { length: 300 }),
    branche: varchar("branche", { length: 160 }),
    /** Vestigingsplaats van het bedrijf. */
    city: varchar("city", { length: 160 }),
    /** Korte beschrijving van het bedrijf (door salesteam ingevuld, optioneel). */
    description: text("description"),
    /** Contactpersoon bij de potentiële klant. */
    contactName: varchar("contact_name", { length: 160 }),
    /** Datum van het kennismakingsgesprek (vrije tekst/datum). */
    meetingDate: varchar("meeting_date", { length: 40 }),
    /** Belangrijkste doelstelling van de prospect (één hoofddoel). */
    primaryGoal: varchar("primary_goal", { length: 60 }),
    /** Gekozen doelstellingen (meerdere), bijv. ["Meer bereik","Meer aanvragen"]. */
    goals: jsonb("goals").notNull().default(sql`'[]'::jsonb`),
    extra: text("extra"),
    status: varchar("status", { length: 24 }).notNull().default("concept"),
    /** Gestructureerd resultaat (bedrijf, social-analyse, pijnpunten, kansen,
     *  video-ideeën, concurrenten, slide-selectie). */
    result: jsonb("result").notNull().default(sql`'{}'::jsonb`),
    /** Eerdere versies van het resultaat (undo): [{ at, result }]. */
    resultVersions: jsonb("result_versions").notNull().default(sql`'[]'::jsonb`),
    /** Bronlinks: [{ label, url, checkedAt }]. */
    sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("sales_research_client_idx").on(t.clientId)],
);

export const salesResearchRelations = relations(salesResearch, ({ one }) => ({
  client: one(clients, { fields: [salesResearch.clientId], references: [clients.id] }),
  createdBy: one(users, { fields: [salesResearch.createdById], references: [users.id] }),
}));

export const clientAiProfilesRelations = relations(clientAiProfiles, ({ one }) => ({
  client: one(clients, { fields: [clientAiProfiles.clientId], references: [clients.id] }),
}));

export const aiOutputsRelations = relations(aiOutputs, ({ one }) => ({
  client: one(clients, { fields: [aiOutputs.clientId], references: [clients.id] }),
  createdBy: one(users, { fields: [aiOutputs.createdById], references: [users.id] }),
}));
