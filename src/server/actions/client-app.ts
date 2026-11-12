"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, notificationPreferences, notifications, pushSubscriptions, users } from "@/db/schema";
import {
  assertClientAccess,
  ForbiddenError,
  requireManageClients,
  requirePortal,
} from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { markRead } from "@/server/notifications";
import { getClientAppStatus, PUSH_DEVICE_COOKIE } from "@/server/client-app";
import { flushPendingPush, pushConfigured, sendPushToUser, channelEnabled } from "@/server/push";
import { CLIENT_NOTIFICATION_TYPE_SET, isQuietHours, safePortalHref } from "@/lib/push-rules";
import { isProduction, env } from "@/lib/env";
import { portalEmailHtml, sendEmail } from "@/server/email";

type Result = { ok: boolean; message?: string };

/* ------------------------------------------------------------------ *
 * Klantkant (portaal / app)
 * ------------------------------------------------------------------ */

const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("https://"), "Ongeldig adres"),
  keys: z.object({
    p256dh: z.string().min(10).max(200),
    auth: z.string().min(8).max(100),
  }),
  platform: z.enum(["ios", "android", "desktop"]).optional(),
});

/** Slaat het push-abonnement van dit apparaat op voor de ingelogde klant. */
export async function savePushSubscription(input: z.infer<typeof subscriptionSchema>): Promise<Result> {
  const viewer = await requirePortal();
  if (!pushConfigured()) return { ok: false, message: "Pushmeldingen zijn nog niet ingeschakeld door Shortclips." };
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dit apparaat gaf geen geldig abonnement terug." };
  const { endpoint, keys, platform } = parsed.data;
  const h = await headers();

  // Eén abonnement per apparaat. Logt een andere klantgebruiker in op hetzelfde
  // toestel, dan gaat het abonnement over naar die gebruiker.
  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      userId: viewer.id,
      clientId: viewer.clientId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      platform: platform ?? null,
      userAgent: h.get("user-agent"),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: viewer.id,
        clientId: viewer.clientId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        platform: platform ?? null,
        userAgent: h.get("user-agent"),
        revokedAt: null,
        failureCount: 0,
        updatedAt: new Date(),
      },
    })
    .returning({ id: pushSubscriptions.id });

  const store = await cookies();
  store.set(PUSH_DEVICE_COOKIE, row!.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  });
  return { ok: true };
}

/** Meldingen uitzetten op dit apparaat. */
export async function removePushSubscription(input: { endpoint: string }): Promise<Result> {
  const viewer = await requirePortal();
  if (typeof input?.endpoint !== "string") return { ok: false };
  await db
    .update(pushSubscriptions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.userId, viewer.id)));
  const store = await cookies();
  store.delete(PUSH_DEVICE_COOKIE);
  return { ok: true };
}

/** Testmelding naar de eigen apparaten, direct na het aanzetten. */
export async function sendTestPush(): Promise<Result> {
  const viewer = await requirePortal();
  const res = await sendPushToUser(viewer.id, viewer.clientId, {
    title: "Meldingen staan aan",
    body: "Je krijgt hier een seintje zodra er iets voor je klaarstaat.",
    href: "/portal",
    tag: "test",
    notificationIds: [],
  });
  if (res.devices === 0) return { ok: false, message: "Er is nog geen apparaat aangemeld voor meldingen." };
  if (res.delivered === 0) return { ok: false, message: "De testmelding kon niet worden afgeleverd. Zet meldingen opnieuw aan." };
  return { ok: true };
}

const prefSchema = z.object({
  type: z.string().refine((t) => CLIENT_NOTIFICATION_TYPE_SET.has(t)),
  channel: z.enum(["push", "email"]),
  enabled: z.boolean(),
});

/** Een soort melding per kanaal aan- of uitzetten. */
export async function setNotificationPreference(input: z.infer<typeof prefSchema>): Promise<Result> {
  const viewer = await requirePortal();
  const parsed = prefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Onbekende instelling." };
  const { type, channel, enabled } = parsed.data;
  await db
    .insert(notificationPreferences)
    .values({ userId: viewer.id, type, channel, isEnabled: enabled })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.type, notificationPreferences.channel],
      set: { isEnabled: enabled, updatedAt: new Date() },
    });
  revalidatePath("/portal/account");
  return { ok: true };
}

/** Alle meldingen als gelezen markeren (bij het openen van het meldingencentrum). */
export async function markAllPortalNotificationsRead(): Promise<Result> {
  const viewer = await requirePortal();
  // Bewust geen revalidate: de klant ziet op deze pagina nog welke meldingen
  // nieuw waren; het belletje telt bij de volgende pagina weer goed.
  await markRead(viewer.id);
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Teamkant (intern dashboard)
 * ------------------------------------------------------------------ */

const manualSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(3, "Geef de melding een titel.").max(80, "Houd de titel korter dan 80 tekens."),
  body: z.string().trim().max(240, "Houd de tekst korter dan 240 tekens.").optional().default(""),
  href: z.string().optional(),
  alsoEmail: z.boolean().optional().default(false),
});

/**
 * Handmatige melding aan alle actieve portaalgebruikers van één klant. Komt in
 * het meldingencentrum, als push in de app (buiten stille uren) en optioneel
 * per e-mail. Alleen voor de eigenaar en projectcoördinatoren.
 */
export async function sendManualClientNotification(
  input: z.input<typeof manualSchema>,
): Promise<Result & { recipients?: number; pushed?: number; queued?: boolean }> {
  try {
    const viewer = await requireManageClients();
    const parsed = manualSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer de melding." };
    const { clientId, title, body, alsoEmail } = parsed.data;
    assertClientAccess(viewer, clientId);
    const href = safePortalHref(parsed.data.href);

    const recipients = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.clientId, clientId),
          eq(users.primaryRole, "client"),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      );
    if (recipients.length === 0) return { ok: false, message: "Deze klant heeft nog geen actieve portaalgebruiker." };

    const batch = randomUUID();
    for (const r of recipients) {
      const wantsPush = await channelEnabled(r.id, "manual", "push");
      await db.insert(notifications).values({
        userId: r.id,
        clientId,
        type: "manual",
        level: "info",
        title,
        body: body || null,
        href,
        dedupeKey: `manual:${batch}`,
        pushState: wantsPush ? "pending" : null,
      });
      if (alsoEmail && (await channelEnabled(r.id, "manual", "email"))) {
        const url = `${env.APP_URL.replace(/\/$/, "")}${href}`;
        await sendEmail({
          to: r.email,
          subject: title,
          text: `${body}\n\nBekijk het in je omgeving: ${url}`,
          html: portalEmailHtml({ heading: title, body, ctaLabel: "Bekijk in je omgeving", ctaUrl: url }),
          replyTo: viewer.email,
        }).catch(() => undefined);
      }
    }

    const quiet = isQuietHours();
    const flush = await flushPendingPush();
    await auditLog({
      viewer,
      action: "portal.manual_notification",
      entityType: "client",
      entityId: clientId,
      clientId,
      changes: { title, recipients: recipients.length, email: alsoEmail },
    });
    revalidatePath("/klantenbeheer");
    return {
      ok: true,
      recipients: recipients.length,
      pushed: flush.pushes,
      queued: quiet,
      message: quiet
        ? "Melding geplaatst. De pushmelding gaat na 08:00 uur uit (stille uren)."
        : `Melding verstuurd naar ${recipients.length} gebruiker${recipients.length === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Inlogcode per e-mail (tweestapsverificatie) voor een klant aan- of uitzetten. */
export async function setClientLoginCodeRequired(clientId: string, required: boolean): Promise<Result> {
  try {
    const viewer = await requireManageClients();
    if (!z.string().uuid().safeParse(clientId).success) return { ok: false, message: "Onbekende klant." };
    assertClientAccess(viewer, clientId);
    await db
      .update(clients)
      .set({ portalLoginCodeRequired: required, updatedAt: new Date() })
      .where(eq(clients.id, clientId));
    await auditLog({
      viewer,
      action: required ? "portal.login_code_enabled" : "portal.login_code_disabled",
      entityType: "client",
      entityId: clientId,
      clientId,
    });
    revalidatePath("/klantenbeheer");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Status van de app voor één klant (apparaten, inlogcode, laatste pushes). */
export async function loadClientAppStatus(clientId: string) {
  try {
    const viewer = await requireManageClients();
    if (!z.string().uuid().safeParse(clientId).success) return { ok: false as const, message: "Onbekende klant." };
    assertClientAccess(viewer, clientId);
    const status = await getClientAppStatus(clientId);
    return { ok: true as const, pushReady: pushConfigured(), ...status };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false as const, message: error.message };
    throw error;
  }
}
