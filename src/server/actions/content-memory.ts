"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { refreshContentMemoryAi } from "@/server/content-memory";

export type MemoryActionResult = { ok: true; message: string } | { ok: false; message: string };

/** "Nu bijwerken": formats en ideeën direct opnieuw laten bepalen (normaal gebeurt dit 's nachts). */
export async function refreshContentMemoryAction(clientId: string): Promise<MemoryActionResult> {
  try {
    const viewer = await requirePermission("analytics:read");
    assertClientAccess(viewer, clientId);
    const res = await refreshContentMemoryAi(clientId, { force: true });
    revalidatePath("/contentgeheugen");
    return res.ok
      ? { ok: true, message: res.labeled ? `${res.labeled} video's van een format voorzien.` : "Bijgewerkt." }
      : { ok: false, message: res.reason ?? "Bijwerken lukte niet." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    return { ok: false, message: "Bijwerken lukte niet." };
  }
}
