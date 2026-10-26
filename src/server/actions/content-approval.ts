"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { contentCalendar } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";

export type ActionResult = { ok: boolean; message?: string; shared?: number };

/**
 * Keurt de contentplanning van een klant goed en deelt die met de klant: alle
 * geplande items (ready/scheduled/published) worden zichtbaar in het klantportaal.
 * Conceptplanningen (to_prepare) blijven onzichtbaar tot ze zijn ingepland en
 * gedeeld. Idempotent: al gedeelde items blijven gewoon staan.
 */
export async function shareContentPlanning(clientId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("calendar:write");
    assertClientAccess(viewer, clientId);
    const updated = await db
      .update(contentCalendar)
      .set({ clientApproved: true, clientApprovedAt: new Date(), clientApprovedById: viewer.id, updatedAt: new Date() })
      .where(and(
        eq(contentCalendar.clientId, clientId),
        isNull(contentCalendar.deletedAt),
        eq(contentCalendar.clientApproved, false),
        inArray(contentCalendar.status, ["ready", "scheduled", "published"]),
      ))
      .returning({ id: contentCalendar.id });

    if (updated.length > 0) {
      await auditLog({ viewer, action: "content_planning.shared", entityType: "client", entityId: clientId, clientId, changes: { shared: updated.length } });
      await recordActivity({ clientId, type: "content_planning.shared", title: "Contentplanning gedeeld met de klant", isClientVisible: true });
    }
    revalidatePath("/calendar");
    revalidatePath("/portal/planning");
    return { ok: true, shared: updated.length };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Haalt een item weer uit het zicht van de klant (concept terugtrekken). */
export async function unshareContentItem(itemId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("calendar:write");
    const [item] = await db.select({ clientId: contentCalendar.clientId }).from(contentCalendar).where(eq(contentCalendar.id, itemId)).limit(1);
    if (!item) return { ok: false, message: "Item niet gevonden." };
    assertClientAccess(viewer, item.clientId);
    await db.update(contentCalendar).set({ clientApproved: false, clientApprovedAt: null, clientApprovedById: null, updatedAt: new Date() }).where(eq(contentCalendar.id, itemId));
    revalidatePath("/calendar");
    revalidatePath("/portal/planning");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
