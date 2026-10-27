import { boolean, index, integer, numeric, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { scriptReviewStatusEnum } from "./enums";
import { clients } from "./clients";
import { productionDays } from "./production";
import { users } from "./identity";

/**
 * Script-PDF-review in het klantportaal — de in-portaal vervanger van Adobe.
 *
 * Eén reviewdocument per opnamesessie (productionDay) van een klant. Daaronder
 * hangen PDF-versies (elke nieuwe oplevering = een nieuwe versie) en de
 * opmerkingen van de klant (en interne reacties) per pagina/positie. De klant
 * ziet uitsluitend de eigen reviews (hard gescoped op clientId).
 */
export const scriptReviews = pgTable(
  "script_reviews",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** De opnamesessie waar deze scripts bij horen. */
    productionDayId: uuid("production_day_id")
      .notNull()
      .references(() => productionDays.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    status: scriptReviewStatusEnum("status").notNull().default("klaar_controle"),
    /** Nummer van de laatst opgeleverde PDF-versie. */
    currentVersion: integer("current_version").notNull().default(1),
    /** Optionele deadline waarvoor de klant feedback/akkoord moet geven. */
    feedbackDeadline: timestamp("feedback_deadline", { withTimezone: true }),
    /** Definitieve goedkeuring: wie, wanneer en welke versie (zodat een latere
     *  versie nooit per ongeluk als goedgekeurd geldt). */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedVersion: integer("approved_version"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("script_reviews_client_idx").on(t.clientId, t.status),
    index("script_reviews_day_idx").on(t.productionDayId),
  ],
);

/** PDF-versies van een reviewdocument (base64 in de database, zoals edit_project_files). */
export const scriptReviewVersions = pgTable(
  "script_review_versions",
  {
    id: pk(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => scriptReviews.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Oude versies: PDF als base64 in de database. Nieuwe, grote uploads gaan
     *  via `storagePath` naar Supabase Storage (langs de 4,5MB-requestlimiet). */
    dataBase64: text("data_base64"),
    /** Opslagsleutel in Supabase Storage (als de PDF daar staat i.p.v. base64). */
    storagePath: text("storage_path"),
    /** Korte toelichting bij deze versie (wat is aangepast). */
    note: text("note"),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("script_review_versions_unique").on(t.reviewId, t.versionNumber)],
);

/**
 * Een opmerkingdraad op een reviewdocument. `pageNumber` + `posX/posY` (relatief
 * 0..1) leggen vast wáár op de PDF de opmerking staat; `pageNumber` leeg = een
 * algemene opmerking over de hele PDF. `visibility` scheidt klant- en interne
 * opmerkingen (interne worden nooit aan de klant getoond).
 */
export const scriptReviewThreads = pgTable(
  "script_review_threads",
  {
    id: pk(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => scriptReviews.id, { onDelete: "cascade" }),
    /** Op welke PDF-versie de opmerking is geplaatst. */
    versionNumber: integer("version_number").notNull(),
    /** Pagina (1-based); leeg = algemene opmerking over de hele PDF. */
    pageNumber: integer("page_number"),
    posX: numeric("pos_x", { precision: 6, scale: 5 }),
    posY: numeric("pos_y", { precision: 6, scale: 5 }),
    visibility: varchar("visibility", { length: 10 }).notNull().default("client"),
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    authorName: varchar("author_name", { length: 160 }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("script_review_threads_review_idx").on(t.reviewId, t.versionNumber),
  ],
);

/** Berichten binnen een opmerkingdraad (klantopmerking + interne reacties). */
export const scriptReviewComments = pgTable(
  "script_review_comments",
  {
    id: pk(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => scriptReviewThreads.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: varchar("author_name", { length: 160 }),
    /** Interne reactie (nooit aan de klant tonen). */
    isInternal: boolean("is_internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("script_review_comments_thread_idx").on(t.threadId)],
);
