"use server";

import { requirePermission, ForbiddenError } from "@/server/auth/context";
import { setDeadlineSetting, type DeadlineSettingKey } from "@/server/deadline-settings";
import { auditLog } from "@/server/audit";
import { revalidatePath } from "next/cache";

/** Eén deadline-termijn zetten (beheer). Geeft de begrensde waarde terug. */
export async function updateDeadlineSetting(key: string, value: number): Promise<{ ok: true; value: number } | { ok: false; message: string }> {
  try {
    const viewer = await requirePermission("settings:write");
    const saved = await setDeadlineSetting(key as DeadlineSettingKey, value, viewer.id);
    await auditLog({ viewer, action: "settings.deadline_updated", entityType: "setting", entityId: key, changes: { key, value: saved } });
    revalidatePath("/settings/deadlines");
    return { ok: true, value: saved };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    if (error instanceof Error) return { ok: false, message: error.message };
    throw error;
  }
}
