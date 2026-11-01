import { relations, sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete } from "./_shared";
import { transferStatusEnum } from "./enums";
import { users } from "./identity";

/* ------------------------------------------------------------------ *
 * Shortclips Transfer — eigen WeTransfer-vervanger.
 *
 * Grote bestanden gaan via presigned multipart-URL's rechtstreeks tussen de
 * browser en Cloudflare R2 (S3-compatibel); de applicatieserver zit nooit in
 * het datapad. We bewaren hier alleen de metadata + de opslagsleutels.
 * ------------------------------------------------------------------ */

export const transfers = pgTable(
  "transfers",
  {
    id: pk(),
    /** Publieke, onvoorspelbare deel-code (gebruikt in /d/<code>). */
    code: varchar("code", { length: 48 }).notNull().unique(),
    /** Teamlid dat de transfer aanmaakte. */
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    /** Korte naam (afgeleid van de bestanden; geen verplicht veld voor de gebruiker). */
    title: varchar("title", { length: 240 }).notNull().default("Transfer"),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
    fileCount: integer("file_count").notNull().default(0),
    status: transferStatusEnum("status").notNull().default("uploading"),
    /** Wanneer de volledige upload is afgerond (start van de termijnen). */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Tot wanneer de ontvanger mag downloaden (completedAt + 30 dagen). */
    downloadExpiresOn: timestamp("download_expires_on", { withTimezone: true }),
    /** Tot wanneer de bestanden bewaard blijven (completedAt + 45 dagen). */
    storageExpiresOn: timestamp("storage_expires_on", { withTimezone: true }),
    /** Aantal geregistreerde downloads. */
    downloadCount: integer("download_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    ...softDelete,
  },
  (t) => [
    index("transfers_owner_idx").on(t.ownerId, t.status),
    index("transfers_status_idx").on(t.status),
  ],
);

export const transferFiles = pgTable(
  "transfer_files",
  {
    id: pk(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => transfers.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 400 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    contentType: varchar("content_type", { length: 160 }),
    /** Opslagsleutel in R2 (object key). */
    r2Key: text("r2_key").notNull(),
    /** R2 multipart-upload-id — nodig om delen te signen/voltooien/afbreken. */
    uploadId: text("upload_id"),
    /** 'uploading' | 'done'. */
    status: varchar("status", { length: 16 }).notNull().default("uploading"),
    /** Grootte van de upload-delen (bytes) waarmee de browser moet splitsen. */
    partSize: bigint("part_size", { mode: "number" }).notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("transfer_files_transfer_idx").on(t.transferId)],
);

export const transfersRelations = relations(transfers, ({ one, many }) => ({
  owner: one(users, { fields: [transfers.ownerId], references: [users.id] }),
  files: many(transferFiles),
}));

export const transferFilesRelations = relations(transferFiles, ({ one }) => ({
  transfer: one(transfers, { fields: [transferFiles.transferId], references: [transfers.id] }),
}));
