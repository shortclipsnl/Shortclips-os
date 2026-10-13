"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productionDays } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { SCRIPTING_ORDER } from "@/lib/statuses";

export type ActionResult = { ok: boolean; message?: string };

/** Scriptingstatus van een opnamedag wijzigen (één klik, Monday-stijl). */
export async function setScriptingStatus(productionDayId: string, status: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    if (!(SCRIPTING_ORDER as readonly string[]).includes(status)) {
      return { ok: false, message: "Onbekende scriptingstatus." };
    }
    const [day] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId })
      .from(productionDays)
      .where(eq(productionDays.id, productionDayId))
      .limit(1);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    await db.update(productionDays).set({ scriptingStatus: status, updatedAt: new Date() }).where(eq(productionDays.id, productionDayId));
    revalidatePath("/scripting");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
