import "server-only";
import webpush from "web-push";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notificationPreferences, notifications, pushDeliveries, pushSubscriptions, users } from "@/db/schema";
import { env } from "@/lib/env";
import {
  bundlePending,
  isQuietHours,
  localParts,
  lockScreenSafe,
  remainingToday,
  type PendingPush,
  type PushPayload,
} from "@/lib/push-rules";

/**
 * Web Push naar de klant-app (PWA). Werkt zonder externe dienst: de berichten
 * gaan rechtstreeks naar de pushdienst van Apple, Google of Mozilla, versleuteld
 * met de sleutels van het apparaat (die diensten kunnen de inhoud niet lezen).
 *
 * Zonder VAPID-sleutels blijft push slapend; de rest van de meldingen werkt dan
 * gewoon (portaal + e-mail).
 */

let configured: boolean | null = null;

export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

/** Publieke sleutel voor de browser (mag gedeeld worden). */
export function vapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

/** Stuurt één bericht naar alle actieve apparaten van een gebruiker. */
export async function sendPushToUser(
  userId: string,
  clientId: string | null,
  payload: PushPayload,
): Promise<{ delivered: number; failed: number; devices: number }> {
  if (!pushConfigured()) return { delivered: 0, failed: 0, devices: 0 };

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)));

  let delivered = 0;
  let failed = 0;
  const body = JSON.stringify({
    title: lockScreenSafe(payload.title, 80),
    body: lockScreenSafe(payload.body),
    href: payload.href,
    tag: payload.tag,
  });

  for (const sub of subs) {
    try {
      const res = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 60 * 60 * 24, urgency: "normal", topic: topicFor(payload.tag) },
      );
      delivered++;
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date(), failureCount: 0, updatedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id));
      await logDelivery(payload, sub.id, userId, clientId, "sent", res.statusCode, null);
    } catch (error) {
      failed++;
      const statusCode = (error as { statusCode?: number }).statusCode ?? null;
      // 404/410: het abonnement bestaat niet meer bij de pushdienst (app
      // verwijderd, toestemming ingetrokken of verlopen). Direct opruimen.
      const gone = statusCode === 404 || statusCode === 410;
      await db
        .update(pushSubscriptions)
        .set({
          failureCount: sql`${pushSubscriptions.failureCount} + 1`,
          ...(gone ? { revokedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(pushSubscriptions.id, sub.id));
      await logDelivery(
        payload,
        sub.id,
        userId,
        clientId,
        gone ? "expired" : "failed",
        statusCode,
        String((error as { body?: string; message?: string }).body ?? (error as Error).message ?? error).slice(0, 500),
      );
    }
  }

  return { delivered, failed, devices: subs.length };
}

/** Topic mag alleen URL-veilige tekens bevatten en max. 32 lang zijn. */
function topicFor(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
}

async function logDelivery(
  payload: PushPayload,
  subscriptionId: string,
  userId: string,
  clientId: string | null,
  status: "sent" | "failed" | "expired",
  statusCode: number | null,
  error: string | null,
) {
  // Eén logregel per apparaat; gekoppeld aan de eerste melding van de bundel.
  await db.insert(pushDeliveries).values({
    notificationId: payload.notificationIds[0] ?? null,
    subscriptionId,
    userId,
    clientId,
    status,
    statusCode,
    title: payload.title.slice(0, 240),
    error,
  });
}

/**
 * Of een gebruiker een soort melding via een kanaal wil ontvangen. Standaard
 * aan; alleen een expliciete "uit" in notification_preferences zet hem uit.
 */
export async function channelEnabled(userId: string, type: string, channel: "push" | "email"): Promise<boolean> {
  const [pref] = await db
    .select({ isEnabled: notificationPreferences.isEnabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.type, type),
        eq(notificationPreferences.channel, channel),
      ),
    )
    .limit(1);
  return pref ? pref.isEnabled : true;
}

/**
 * Verstuurt alle wachtende pushmeldingen, met de spelregels (stille uren,
 * daglimiet, bundelen). Idempotent: elke melding gaat hooguit één keer uit.
 * Wordt aangeroepen na het aanmaken van meldingen en elk uur door de taak.
 */
export async function flushPendingPush(opts: { now?: Date; ignoreQuietHours?: boolean } = {}): Promise<{
  ok: boolean;
  quiet: boolean;
  users: number;
  pushes: number;
  skipped: number;
}> {
  const now = opts.now ?? new Date();
  if (!opts.ignoreQuietHours && isQuietHours(now)) {
    return { ok: true, quiet: true, users: 0, pushes: 0, skipped: 0 };
  }

  // Meldingen ouder dan twee dagen hebben als push geen zin meer.
  const cutoff = new Date(now.getTime() - 2 * 86_400_000);
  await db
    .update(notifications)
    .set({ pushState: "skipped" })
    .where(and(eq(notifications.pushState, "pending"), sql`${notifications.createdAt} < ${cutoff}`));

  const pending = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      clientId: notifications.clientId,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(
      and(
        eq(notifications.pushState, "pending"),
        eq(users.primaryRole, "client"),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(notifications.createdAt);

  if (pending.length === 0) return { ok: true, quiet: false, users: 0, pushes: 0, skipped: 0 };

  const byUser = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  // Wat ging er vandaag (Nederlandse dag) al uit per gebruiker? Alleen automatische meldingen tellen.
  const { day } = localParts(now);
  const dayStart = new Date(now.getTime() - 26 * 3_600_000);
  const sentRows = await db
    .select({ userId: notifications.userId, pushSentAt: notifications.pushSentAt, type: notifications.type })
    .from(notifications)
    .where(
      and(
        inArray(notifications.userId, [...byUser.keys()]),
        eq(notifications.pushState, "sent"),
        gte(notifications.pushSentAt, dayStart),
      ),
    );
  const sentToday = new Map<string, number>();
  for (const r of sentRows) {
    if (r.type === "manual" || !r.pushSentAt) continue;
    if (localParts(r.pushSentAt).day !== day) continue;
    sentToday.set(r.userId, (sentToday.get(r.userId) ?? 0) + 1);
  }

  let pushes = 0;
  let skipped = 0;

  for (const [userId, rows] of byUser) {
    const clientId = rows[0]?.clientId ?? null;
    const items: PendingPush[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      href: r.href,
      createdAt: r.createdAt,
    }));
    const payloads = bundlePending(items);
    let budget = remainingToday(sentToday.get(userId) ?? 0);

    for (const payload of payloads) {
      const isManual = payload.tag.startsWith("manual:");
      if (!isManual && budget <= 0) {
        // Daglimiet bereikt: niet als push, wel zichtbaar in het meldingencentrum.
        await db.update(notifications).set({ pushState: "skipped" }).where(inArray(notifications.id, payload.notificationIds));
        skipped += payload.notificationIds.length;
        continue;
      }

      const result = await sendPushToUser(userId, clientId, payload);
      if (result.devices === 0) {
        await db.update(notifications).set({ pushState: "skipped" }).where(inArray(notifications.id, payload.notificationIds));
        skipped += payload.notificationIds.length;
        continue;
      }

      const [firstId, ...rest] = payload.notificationIds;
      await db.update(notifications).set({ pushState: "sent", pushSentAt: now }).where(eq(notifications.id, firstId!));
      if (rest.length) {
        await db.update(notifications).set({ pushState: "bundled", pushSentAt: now }).where(inArray(notifications.id, rest));
      }
      pushes++;
      if (!isManual) budget--;
    }
  }

  return { ok: true, quiet: false, users: byUser.size, pushes, skipped };
}

/** Trekt alle push-abonnementen van een gebruiker in (uitloggen elders, blokkade). */
export async function revokePushForUser(userId: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)));
}

/** Recente afleveringen per klant, voor het overzicht in het interne dashboard. */
export async function recentDeliveriesForClient(clientId: string, limit = 8) {
  return db
    .select({
      id: pushDeliveries.id,
      status: pushDeliveries.status,
      statusCode: pushDeliveries.statusCode,
      title: pushDeliveries.title,
      createdAt: pushDeliveries.createdAt,
      email: users.email,
    })
    .from(pushDeliveries)
    .leftJoin(users, eq(users.id, pushDeliveries.userId))
    .where(eq(pushDeliveries.clientId, clientId))
    .orderBy(desc(pushDeliveries.createdAt))
    .limit(limit);
}
