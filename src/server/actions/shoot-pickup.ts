"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { shootPickups } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";

export type ShootPickupStatus = "nieuw" | "opgepakt" | "afgehandeld";
type Result = { ok: boolean; message?: string };

/**
 * Oppak-status van een nog-niet-ingeplande klant op de Opnameplanning. Puur een
 * werklijst-markering — raakt de echte opnameplanning of klantgegevens niet.
 * "nieuw" (nog niet opgepakt) = geen rij; andere statussen bewaren wie + wanneer.
 */
export async function setShootPickup(clientId: string, status: ShootPickupStatus): Promise<Result> {
  try {
    const viewer = await requirePermission("productions:write");
    assertClientAccess(viewer, clientId);

    if (status === "nieuw") {
      await db.delete(shootPickups).where(eq(shootPickups.clientId, clientId));
    } else {
      await db
        .insert(shootPickups)
        .values({ clientId, status, byUserId: viewer.id })
        .onConflictDoUpdate({
          target: shootPickups.clientId,
          set: { status, byUserId: viewer.id, updatedAt: new Date() },
        });
    }

    revalidatePath("/productions");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
