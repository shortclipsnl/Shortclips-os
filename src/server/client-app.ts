import "server-only";
import { cookies } from "next/headers";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  notificationPreferences,
  notifications,
  pushSubscriptions,
  users,
} from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { scopeToClients } from "@/server/auth/context";
import { CLIENT_NOTIFICATION_TYPES } from "@/lib/push-rules";
import { recentDeliveriesForClient } from "@/server/push";

/**
 * Datalaag voor de klant-app: meldingencentrum, openstaande acties (tellers op
 * de tabs) en meldingsvoorkeuren. Alles is gebonden aan de ingelogde gebruiker
 * of via scopeToClients aan de eigen klant.
 */

/** Cookie met het id van het push-abonnement van dit apparaat (voor uitloggen). */
export const PUSH_DEVICE_COOKIE = "sc_os_push";

/** Trekt het push-abonnement van dit apparaat in (bij uitloggen). */
export async function forgetThisDevicePush(userId: string): Promise<void> {
  const store = await cookies();
  const subId = store.get(PUSH_DEVICE_COOKIE)?.value;
  if (!subId || !/^[0-9a-f-]{36}$/i.test(subId)) return;
  await db
    .update(pushSubscriptions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pushSubscriptions.id, subId), eq(pushSubscriptions.userId, userId)));
  store.delete(PUSH_DEVICE_COOKIE);
}

export type PortalNotification = {
  id: string;
  type: string;
  level: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: Date;
  readAt: Date | null;
};

/** De meldingen van de ingelogde klantgebruiker zelf (nooit die van een ander). */
export async function getPortalNotifications(viewer: Viewer, limit = 60): Promise<PortalNotification[]> {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      level: notifications.level,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, viewer.id), scopeToClients(viewer, notifications.clientId)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadNotificationCount(viewer: Viewer): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, viewer.id),
        isNull(notifications.readAt),
        scopeToClients(viewer, notifications.clientId),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Wat wacht er op de klant? Voedt de tellers op de tabs Video's en Scripts. */
export type PreferenceRow = { type: string; label: string; push: boolean; email: boolean };

/** Voorkeuren per soort melding; standaard staat alles aan. */
export async function getNotificationPreferences(userId: string): Promise<PreferenceRow[]> {
  const rows = await db
    .select({
      type: notificationPreferences.type,
      channel: notificationPreferences.channel,
      isEnabled: notificationPreferences.isEnabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const map = new Map(rows.map((r) => [`${r.type}:${r.channel}`, r.isEnabled]));
  return CLIENT_NOTIFICATION_TYPES.map(({ type, label }) => ({
    type,
    label,
    push: map.get(`${type}:push`) ?? true,
    email: map.get(`${type}:email`) ?? true,
  }));
}

/** Overzicht voor het interne dashboard: apparaten, inlogcode, laatste pushes. */
export async function getClientAppStatus(clientId: string) {
  const [client] = await db
    .select({ loginCodeRequired: clients.portalLoginCodeRequired })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const devices = await db
    .select({ platform: pushSubscriptions.platform, email: users.email, lastSuccessAt: pushSubscriptions.lastSuccessAt })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .where(and(eq(pushSubscriptions.clientId, clientId), isNull(pushSubscriptions.revokedAt)));
  const deliveries = await recentDeliveriesForClient(clientId, 6);
  return {
    loginCodeRequired: client?.loginCodeRequired ?? false,
    devices: devices.map((d) => ({ ...d, lastSuccessAt: d.lastSuccessAt?.toISOString() ?? null })),
    deliveries: deliveries.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
  };
}
