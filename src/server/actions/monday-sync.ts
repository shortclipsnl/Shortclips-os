"use server";

import { revalidatePath } from "next/cache";
import { requireOwner, ForbiddenError } from "@/server/auth/context";
import { setBoolSetting, MONDAY_SYNC_KEY } from "@/server/app-settings";

export type ActionResult = { ok: boolean; message?: string };

/**
 * Monday-synchronisatie aan- of uitzetten (alleen de eigenaar). Uit = de app is
 * de bron en haalt niets meer uit Monday; alle schermen blijven werken op de
 * al overgenomen data.
 */
export async function setMondaySync(enabled: boolean): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    await setBoolSetting(MONDAY_SYNC_KEY, enabled, {
      category: "integrations",
      description: "Nachtelijke Monday-import aan/uit (onafhankelijkheidsschakelaar).",
      updatedById: viewer.id,
    });
    revalidatePath("/migratie");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
