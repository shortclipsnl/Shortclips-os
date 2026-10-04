import "server-only";
import {
  and,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, users } from "@/db/schema";

export type NotifyInput = {
  userIds?: string[];
  /** Alternatief: iedereen met deze hoofdrol. */
  roles?: string[];
  clientId?: string | null;
  type: string;
  level?: "info" | "success" | "warning" | "critical";
  title: string;
  body?: string;
  href?: string;
  entityType?: string;
  entityId?: string;
  /** Voorkomt dat dezelfde melding twee keer verschijnt. */
  dedupeKey?: string;
};

/**
 * Meldingen wegschrijven. Kanalen buiten de app (e-mail, WhatsApp) worden hier
 * later aangehaakt: het `notification_preferences`-model bepaalt dan per type en
 * per gebruiker welk kanaal gebruikt wordt. Vandaag is alleen in-app actief.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const targets = new Set(input.userIds ?? []);

  if (input.roles?.length) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.primaryRole, input.roles as ("owner")[]),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      );
    for (const r of rows) targets.add(r.id);
  }

  if (targets.size === 0) return 0;

  const values = [...targets].map((userId) => ({
    userId,
    clientId: input.clientId ?? null,
    type: input.type,
    level: input.level ?? "info",
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    dedupeKey: input.dedupeKey ?? null,
  }));

  const inserted = await db
    .insert(notifications)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  return inserted.length;
}

export async function markRead(userId: string, ids?: string[]) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids?.length ? inArray(notifications.id, ids) : undefined,
      ),
    );
}
