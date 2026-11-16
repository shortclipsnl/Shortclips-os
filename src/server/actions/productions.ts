"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productionChecklistItems, productionDays } from "@/db/schema";
import {
  assertClientAccess,
  ForbiddenError,
  requirePermission,
} from "@/server/auth/context";
import { auditLog } from "@/server/audit";

export type ActionResult = { ok: boolean; message?: string };

export async function toggleChecklistItem(itemId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("productions:write");
    const [item] = await db
      .select({
        id: productionChecklistItems.id,
        isDone: productionChecklistItems.isDone,
        dayId: productionChecklistItems.productionDayId,
        clientId: productionDays.clientId,
      })
      .from(productionChecklistItems)
      .innerJoin(productionDays, eq(productionDays.id, productionChecklistItems.productionDayId))
      .where(eq(productionChecklistItems.id, itemId))
      .limit(1);

    if (!item) return { ok: false, message: "Checklistpunt niet gevonden." };
    assertClientAccess(viewer, item.clientId);

    await db
      .update(productionChecklistItems)
      .set({ isDone: !item.isDone, updatedAt: new Date() })
      .where(eq(productionChecklistItems.id, itemId));

    revalidatePath(`/productions/${item.dayId}`);
    revalidatePath("/productions");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function changeProductionStatus(
  dayId: string,
  status: string,
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("productions:write");
    const [day] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId, status: productionDays.status })
      .from(productionDays)
      .where(eq(productionDays.id, dayId))
      .limit(1);
    if (!day) return { ok: false, message: "Opnamedag niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    await db
      .update(productionDays)
      .set({ status: status as "planned", updatedAt: new Date() })
      .where(eq(productionDays.id, dayId));

    await auditLog({
      viewer,
      action: "production.status_changed",
      entityType: "production_day",
      entityId: dayId,
      clientId: day.clientId,
      changes: { van: day.status, naar: status },
    });

    revalidatePath(`/productions/${dayId}`);
    revalidatePath("/productions");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Videograaf toewijzen/wisselen vanuit de opnameplanning. */
export async function setProductionVideographer(dayId: string, userId: string | null): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("productions:write");
    const [day] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId, videographerId: productionDays.videographerId })
      .from(productionDays)
      .where(eq(productionDays.id, dayId))
      .limit(1);
    if (!day) return { ok: false, message: "Opnamedag niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    await db.update(productionDays).set({ videographerId: userId, updatedAt: new Date() }).where(eq(productionDays.id, dayId));

    await auditLog({
      viewer,
      action: "production.videographer_assigned",
      entityType: "production_day",
      entityId: dayId,
      clientId: day.clientId,
      changes: { van: day.videographerId, naar: userId },
    });

    revalidatePath("/productions");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Opname uit het verleden bevestigen als Afgerond of Geannuleerd (vanuit het
 * blok "Bevestig deze opnames" op de Opnameplanning). Alleen voor opnames op of
 * vóór vandaag: toekomstige opnames annuleer je in Google Agenda (leidend).
 */
export async function confirmShootOutcome(dayId: string, outcome: "completed" | "cancelled"): Promise<ActionResult> {
  try {
    if (outcome !== "completed" && outcome !== "cancelled") return { ok: false, message: "Onbekende status." };
    const viewer = await requirePermission("productions:write");
    const [day] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId, status: productionDays.status, scheduledOn: productionDays.scheduledOn })
      .from(productionDays)
      .where(eq(productionDays.id, dayId))
      .limit(1);
    if (!day) return { ok: false, message: "Opnamedag niet gevonden." };
    assertClientAccess(viewer, day.clientId);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    if (String(day.scheduledOn).slice(0, 10) > today) {
      return { ok: false, message: "Deze opname ligt nog in de toekomst. Verplaats of annuleer hem in Google Agenda." };
    }
    await db.update(productionDays).set({ status: outcome, updatedAt: new Date() }).where(eq(productionDays.id, dayId));
    await auditLog({
      viewer,
      action: "production.status_changed",
      entityType: "production_day",
      entityId: dayId,
      clientId: day.clientId,
      changes: { van: day.status, naar: outcome, via: "opnameplanning_bevestiging" },
    });
    revalidatePath("/productions");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
