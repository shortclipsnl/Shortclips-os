"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications } from "@/db/schema";
import { requireViewer } from "@/server/auth/context";
import { markRead } from "@/server/notifications";

export async function markAllRead(): Promise<{ ok: boolean }> {
  const viewer = await requireViewer();
  await markRead(viewer.id);
  revalidatePath("/notifications");
  return { ok: true };
}

export type PopNotification = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  level: "info" | "success" | "warning" | "critical";
  createdAt: string;
};

/**
 * Nieuwe, ongelezen meldingen van de ingelogde gebruiker die ná `sinceIso` zijn
 * aangemaakt. De pop-up-widget pollt hiermee en toont elke nieuwe melding als een
 * toast met geluid. Werkt voor iedereen intern, inclusief editors.
 */
export async function fetchNewNotifications(sinceIso: string): Promise<{ items: PopNotification[]; since: string }> {
  const viewer = await requireViewer();
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return { items: [], since: sinceIso };
  const now = new Date();

  const cols = {
    id: notifications.id,
    title: notifications.title,
    body: notifications.body,
    href: notifications.href,
    level: notifications.level,
    createdAt: notifications.createdAt,
  };

  // A) Nieuwe meldingen: aangemaakt ná de baseline en niet uitgesteld.
  const fresh = await db
    .select(cols)
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, viewer.id),
        isNull(notifications.readAt),
        isNull(notifications.snoozedUntil),
        gt(notifications.createdAt, since),
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(12);

  // B) Uitgestelde meldingen waarvan de "herinner me later"-tijd is verlopen:
  //    nog één keer tonen, daarna de snooze wissen zodat ze niet blijven
  //    terugkomen (tenzij de gebruiker opnieuw uitstelt).
  const expired = await db
    .select(cols)
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, viewer.id),
        isNull(notifications.readAt),
        isNotNull(notifications.snoozedUntil),
        lte(notifications.snoozedUntil, now),
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(12);
  if (expired.length > 0) {
    await db
      .update(notifications)
      .set({ snoozedUntil: null })
      .where(and(eq(notifications.userId, viewer.id), inArray(notifications.id, expired.map((e) => e.id))));
  }

  // De baseline schuift alleen op voor écht nieuwe meldingen — niet voor
  // verlopen snoozes (anders zouden oudere meldingen opnieuw oppoppen).
  const newSince = fresh.length > 0 ? (fresh[fresh.length - 1]!.createdAt as Date).toISOString() : sinceIso;

  const items = [...fresh, ...expired].map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    href: r.href,
    level: r.level as PopNotification["level"],
    createdAt: (r.createdAt as Date).toISOString(),
  }));
  return { items, since: newSince };
}

/** Een melding uitstellen ("herinner me later"): standaard 30 minuten. Daarna
 *  komt de melding nog één keer terug. */
export async function snoozeNotification(id: string, minutes = 30): Promise<{ ok: boolean }> {
  const viewer = await requireViewer();
  const until = new Date(Date.now() + Math.max(1, minutes) * 60_000);
  await db
    .update(notifications)
    .set({ snoozedUntil: until })
    .where(and(eq(notifications.userId, viewer.id), eq(notifications.id, id)));
  revalidatePath("/notifications");
  return { ok: true };
}

/** Eén melding als gelezen markeren (bij klikken op de toast). */
export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  const viewer = await requireViewer();
  await markRead(viewer.id, [id]);
  revalidatePath("/notifications");
  return { ok: true };
}
