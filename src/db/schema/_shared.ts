import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Kolommen die op vrijwel elke tabel terugkomen.
 *
 * `deletedAt` = soft delete. Queries in de data-laag filteren hier standaard
 * op, zodat verwijderde records nooit per ongeluk in een overzicht opduiken
 * maar wel herstelbaar en auditbaar blijven.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
};

export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

export const pk = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/** Kolommen voor records die uit een extern systeem komen. */
export const externalSync = {
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
};
