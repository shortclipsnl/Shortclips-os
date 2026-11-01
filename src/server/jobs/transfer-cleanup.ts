import "server-only";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { transferFiles, transfers } from "@/db/schema";
import { deleteObjects, r2Configured } from "@/server/transfer/r2";

/**
 * Dagelijkse opschoning van Shortclips Transfer:
 *  - downloadtermijn (30d) voorbij → status 'expired' (intern nog 15 dagen
 *    zichtbaar en heractiveerbaar, ontvanger kan niet meer downloaden);
 *  - bewaartermijn (45d) voorbij → bestanden ECHT uit R2 verwijderen (opslaglaag)
 *    en status 'deleted'.
 * Idempotent: de queries matchen ná verwerking niet meer.
 */
export async function runTransferCleanup(): Promise<{
  ok: boolean;
  expired: number;
  deleted: number;
  objectsRemoved: number;
  note?: string;
}> {
  const now = new Date();

  // 1) Downloadtermijn voorbij → expired.
  const expiredRows = await db
    .update(transfers)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(transfers.status, "available"), isNull(transfers.deletedAt), lt(transfers.downloadExpiresOn, now)))
    .returning({ id: transfers.id });

  // 2) Bewaartermijn voorbij → bestanden uit R2 + status deleted.
  const toDelete = await db
    .select({ id: transfers.id })
    .from(transfers)
    .where(
      and(
        isNull(transfers.deletedAt),
        ne(transfers.status, "deleted"),
        lt(transfers.storageExpiresOn, now),
      ),
    );

  let objectsRemoved = 0;
  let deleted = 0;
  if (toDelete.length) {
    const ids = toDelete.map((t) => t.id);
    if (!r2Configured()) {
      return { ok: false, expired: expiredRows.length, deleted: 0, objectsRemoved: 0, note: "R2 niet ingesteld — bestanden niet verwijderd." };
    }
    for (const id of ids) {
      const files = await db.select({ key: transferFiles.r2Key }).from(transferFiles).where(eq(transferFiles.transferId, id));
      const keys = files.map((f) => f.key).filter(Boolean);
      await deleteObjects(keys);
      objectsRemoved += keys.length;
      await db.update(transfers).set({ status: "deleted", updatedAt: now }).where(eq(transfers.id, id));
      deleted++;
    }
  }

  return { ok: true, expired: expiredRows.length, deleted, objectsRemoved };
}
