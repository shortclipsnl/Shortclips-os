import "server-only";
import { after } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, users } from "@/db/schema";
import { preferenceTypeFor } from "@/lib/push-rules";
import { channelEnabled, flushPendingPush, pushConfigured } from "@/server/push";

/**
 * Brug tussen de bestaande meldingen en de klant-app: zet nieuwe meldingen voor
 * klantgebruikers klaar als push (als de klant dat soort melding als push wil)
 * en verstuurt ze direct na het afronden van het verzoek.
 */
export async function queueClientPush(rows: { id: string; userId: string; type: string }[]): Promise<number> {
  if (rows.length === 0 || !pushConfigured()) return 0;

  const clientUserIds = new Set(
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(users.id, [...new Set(rows.map((r) => r.userId))]),
            eq(users.primaryRole, "client"),
            isNull(users.deletedAt),
          ),
        )
    ).map((u) => u.id),
  );

  const pendingIds: string[] = [];
  for (const row of rows) {
    if (!clientUserIds.has(row.userId)) continue;
    const prefType = preferenceTypeFor(row.type);
    if (!prefType) continue;
    if (!(await channelEnabled(row.userId, prefType, "push"))) continue;
    pendingIds.push(row.id);
  }
  if (pendingIds.length === 0) return 0;

  await db.update(notifications).set({ pushState: "pending" }).where(inArray(notifications.id, pendingIds));
  scheduleFlush();
  return pendingIds.length;
}

/**
 * Verstuurt wachtende pushmeldingen ná het antwoord aan de gebruiker, zodat een
 * klik in het dashboard niet hoeft te wachten op de pushdiensten. Buiten een
 * request (geplande taak) valt dit stil terug: de taak verstuurt zelf.
 */
export function scheduleFlush(fn: () => Promise<unknown> = () => flushPendingPush()): void {
  try {
    after(async () => {
      try {
        await fn();
      } catch {
        /* push mag een actie nooit laten mislukken; de uurlijkse taak vangt het op */
      }
    });
  } catch {
    /* geen request-context: de geplande taak verstuurt */
  }
}
