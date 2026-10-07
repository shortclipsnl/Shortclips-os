import "server-only";
import { and, eq, inArray, isNull, isNotNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, users } from "@/db/schema";

/**
 * Houdt de portaaltoegang gelijk met de samenwerkingsstatus (uit Monday):
 *  - klant 'churned' / 'paused' of verwijderd → portaalgebruiker 'suspended'
 *    (inloggen wordt dan geweigerd in readSession);
 *  - klant weer 'active' → portaalgebruiker weer 'active'.
 * Idempotent: raakt alleen klant-accounts (primary_role = 'client').
 */
export async function enforcePortalAccess(): Promise<{ ok: boolean; suspended: number; reactivated: number }> {
  const inactive = await db
    .select({ id: clients.id })
    .from(clients)
    .where(or(isNotNull(clients.deletedAt), inArray(clients.status, ["churned", "paused"])));
  const inactiveIds = inactive.map((c) => c.id);

  let suspended = 0;
  if (inactiveIds.length) {
    const r = await db
      .update(users)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(and(eq(users.primaryRole, "client"), eq(users.status, "active"), inArray(users.clientId, inactiveIds)))
      .returning({ id: users.id });
    suspended = r.length;
  }

  const active = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.status, "active")));
  const activeIds = active.map((c) => c.id);

  let reactivated = 0;
  if (activeIds.length) {
    const r = await db
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(users.primaryRole, "client"), eq(users.status, "suspended"), inArray(users.clientId, activeIds)))
      .returning({ id: users.id });
    reactivated = r.length;
  }

  return { ok: true, suspended, reactivated };
}
