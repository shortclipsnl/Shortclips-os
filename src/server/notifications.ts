import "server-only";
import {
  and,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, users } from "@/db/schema";
import { activeCoverMap } from "./leave-cover";

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

  // Vervanging bij afwezigheid: is een ontvanger met goedgekeurd verlof, dan
  // krijgt de vervanger de melding er automatisch bij — zodat niets blijft liggen.
  try {
    const covers = await activeCoverMap();
    if (covers.size > 0) {
      for (const uid of [...targets]) {
        const rep = covers.get(uid);
        if (rep) targets.add(rep);
      }
    }
  } catch {
    /* vervanging mag nooit het versturen van de melding tegenhouden */
  }

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

/**
 * Een melding "oplossen": alle meldingen met deze dedupe-sleutel verwijderen,
 * ongeacht ontvanger. Gebruikt wanneer de aanleiding voor een melding wegvalt —
 * bv. een script dat niet meer op "Controle Jarno" staat — zodat de melding
 * verdwijnt i.p.v. te blijven hangen. Verwijderen (niet alleen "gelezen" zetten)
 * is hier bewust: door de unieke constraint (userId, dedupeKey) zou een nog
 * bestaande rij een nieuwe melding blokkeren als dezelfde situatie later terugkeert.
 */
export async function clearByDedupe(dedupeKey: string): Promise<void> {
  if (!dedupeKey) return;
  await db.delete(notifications).where(eq(notifications.dedupeKey, dedupeKey));
}
