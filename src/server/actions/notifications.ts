"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
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
export async function fetchNewNotifications(sinceIso: string): Promise<PopNotification[]> {
  const viewer = await requireViewer();
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return [];
  const rows = await db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      level: notifications.level,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, viewer.id),
        isNull(notifications.readAt),
        gt(notifications.createdAt, since),
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(12);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    href: r.href,
    level: r.level as PopNotification["level"],
    createdAt: (r.createdAt as Date).toISOString(),
  }));
}

/** Eén melding als gelezen markeren (bij klikken op de toast). */
export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  const viewer = await requireViewer();
  await markRead(viewer.id, [id]);
  revalidatePath("/notifications");
  return { ok: true };
}
