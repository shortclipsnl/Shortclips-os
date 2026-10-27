import "server-only";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, scriptReviews, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { CLIENT_ACTION_STATUSES } from "@/server/script-review";

/**
 * Overzichtsdata voor het centrale klantportaal-beheer: per klant of er een
 * portaal actief is, wie de gebruikers zijn, wanneer ze voor het laatst
 * inlogden, en wat er nog openstaat (scripts die op de klant wachten, video's
 * die op goedkeuring wachten). Alles hergebruikt de bestaande gedeelde tabellen
 * en is gescoped: een coördinator ziet alleen de eigen klanten, de eigenaar
 * alles.
 */

export type PortalUserRow = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  hasPassword: boolean;
  lastLoginAt: Date | null;
  invitedAt: Date | null;
};

export type PortalStatus = "actief" | "uitgenodigd" | "gedeactiveerd" | "geen";

export type PortalClientRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  color: string | null;
  clientStatus: string;
  portalStatus: PortalStatus;
  users: PortalUserRow[];
  lastLoginAt: Date | null;
  scriptsWaiting: number;
  videosWaiting: number;
};

export type PortalAdminOverview = {
  rows: PortalClientRow[];
  totals: { actief: number; uitgenodigd: number; geen: number; gedeactiveerd: number; scriptsWaiting: number; videosWaiting: number };
};

export async function listPortalClients(viewer: Viewer): Promise<PortalAdminOverview> {
  const scope = scopeToClients(viewer, clients.id);
  // Lege scope → niets te tonen.
  if (viewer.clientScope !== null && viewer.clientScope.length === 0) {
    return { rows: [], totals: { actief: 0, uitgenodigd: 0, geen: 0, gedeactiveerd: 0, scriptsWaiting: 0, videosWaiting: 0 } };
  }

  const clientRows = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, logoUrl: clients.logoUrl, color: clients.color, status: clients.status })
    .from(clients)
    .where(and(isNull(clients.deletedAt), ne(clients.status, "churned"), scope))
    .orderBy(clients.name);
  if (clientRows.length === 0) {
    return { rows: [], totals: { actief: 0, uitgenodigd: 0, geen: 0, gedeactiveerd: 0, scriptsWaiting: 0, videosWaiting: 0 } };
  }
  const ids = clientRows.map((c) => c.id);

  // Portaalgebruikers per klant.
  const userRows = await db
    .select({
      id: users.id, email: users.email, fullName: users.fullName, status: users.status,
      clientId: users.clientId, passwordHash: users.passwordHash, lastLoginAt: users.lastLoginAt, invitedAt: users.invitedAt,
    })
    .from(users)
    .where(and(eq(users.primaryRole, "client"), inArray(users.clientId, ids), isNull(users.deletedAt)));
  const usersByClient = new Map<string, PortalUserRow[]>();
  for (const u of userRows) {
    if (!u.clientId) continue;
    const list = usersByClient.get(u.clientId) ?? [];
    list.push({
      id: u.id, email: u.email, fullName: u.fullName, status: u.status,
      hasPassword: Boolean(u.passwordHash), lastLoginAt: u.lastLoginAt, invitedAt: u.invitedAt,
    });
    usersByClient.set(u.clientId, list);
  }

  // Scripts die op de klant wachten (per klant).
  const scriptRows = await db
    .select({ clientId: scriptReviews.clientId, n: sql<number>`count(*)::int` })
    .from(scriptReviews)
    .where(and(inArray(scriptReviews.clientId, ids), inArray(scriptReviews.status, CLIENT_ACTION_STATUSES)))
    .groupBy(scriptReviews.clientId);
  const scriptsByClient = new Map(scriptRows.map((r) => [r.clientId, Number(r.n)]));

  // Video's die op goedkeuring (klantcontrole) wachten (per klant).
  const videoRows = await db
    .select({ clientId: deliverables.clientId, n: sql<number>`count(*)::int` })
    .from(deliverables)
    .where(and(inArray(deliverables.clientId, ids), eq(deliverables.status, "client_review"), isNull(deliverables.deletedAt)))
    .groupBy(deliverables.clientId);
  const videosByClient = new Map(videoRows.map((r) => [r.clientId ?? "", Number(r.n)]));

  const totals = { actief: 0, uitgenodigd: 0, geen: 0, gedeactiveerd: 0, scriptsWaiting: 0, videosWaiting: 0 };
  const rows: PortalClientRow[] = clientRows.map((c) => {
    const us = usersByClient.get(c.id) ?? [];
    const portalStatus = derivePortalStatus(us);
    totals[portalStatus]++;
    const scriptsWaiting = scriptsByClient.get(c.id) ?? 0;
    const videosWaiting = videosByClient.get(c.id) ?? 0;
    totals.scriptsWaiting += scriptsWaiting;
    totals.videosWaiting += videosWaiting;
    const lastLoginAt = us.reduce<Date | null>((acc, u) => {
      if (!u.lastLoginAt) return acc;
      return !acc || u.lastLoginAt > acc ? u.lastLoginAt : acc;
    }, null);
    return {
      id: c.id, name: c.name, slug: c.slug, logoUrl: c.logoUrl, color: c.color, clientStatus: c.status,
      portalStatus, users: us, lastLoginAt, scriptsWaiting, videosWaiting,
    };
  });

  return { rows, totals };
}

function derivePortalStatus(us: PortalUserRow[]): PortalStatus {
  if (us.length === 0) return "geen";
  if (us.some((u) => u.status === "active" && u.hasPassword)) return "actief";
  if (us.some((u) => u.status === "invited" || (u.status === "active" && !u.hasPassword))) return "uitgenodigd";
  if (us.some((u) => u.status === "suspended")) return "gedeactiveerd";
  return "geen";
}
