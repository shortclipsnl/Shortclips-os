import "server-only";
import { and, eq, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientIntegrations, clients, users } from "@/db/schema";

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

/**
 * Read-only overzicht van de portaaldekking: hoeveel (echte) klanten hebben al
 * een actief portaalaccount en welke actieve klanten nog niet. Handig om vóór
 * livegang te zien of iedereen een login heeft. Verandert niets.
 */
export async function portalAccessReport(): Promise<{
  ok: boolean;
  activeClients: number;
  realClients: number;
  withPortalUser: number;
  placeholderLogins: number;
  realEmailLogins: number;
  missingPortal: { name: string; status: string }[];
}> {
  // Echte klanten = klanten met een Monday-koppeling (zoals pilot-setup kiest).
  const realRows = await db
    .selectDistinct({ id: clientIntegrations.clientId })
    .from(clientIntegrations)
    .where(eq(clientIntegrations.provider, "monday"));
  const realIds = new Set(realRows.map((r) => r.id));

  const clientRows = await db
    .select({ id: clients.id, name: clients.name, status: clients.status })
    .from(clients)
    .where(isNull(clients.deletedAt));

  const portalUsers = await db
    .select({ clientId: users.clientId, email: users.email })
    .from(users)
    .where(and(eq(users.primaryRole, "client"), eq(users.status, "active"), isNull(users.deletedAt)));
  const hasPortal = new Set(portalUsers.filter((r) => r.clientId).map((r) => r.clientId!));
  const placeholderLogins = portalUsers.filter((r) =>
    r.email.toLowerCase().endsWith("@pilot.shortclips.nl"),
  ).length;

  const activeClients = clientRows.filter((c) => c.status === "active");
  const missingPortal = activeClients
    .filter((c) => !hasPortal.has(c.id))
    .map((c) => ({ name: c.name, status: c.status }));

  return {
    ok: true,
    activeClients: activeClients.length,
    realClients: clientRows.filter((c) => realIds.has(c.id)).length,
    withPortalUser: clientRows.filter((c) => hasPortal.has(c.id)).length,
    placeholderLogins,
    realEmailLogins: portalUsers.length - placeholderLogins,
    missingPortal,
  };
}
