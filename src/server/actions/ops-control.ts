"use server";

import { revalidatePath } from "next/cache";
import { canManageOperations, isOwner, requireInternal, requirePermission, ForbiddenError } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { runOpsControl, escalateItemToJarno } from "@/server/ops-control/run";
import { getOpsSettings, resolveEscalationPeople, saveOpsSettings, type OpsControlSettings } from "@/server/ops-control/settings";

type Result = { ok: true; message?: string } | { ok: false; message: string };

async function requireLeadOrOps() {
  const viewer = await requireInternal();
  const people = await resolveEscalationPeople();
  const allowed = isOwner(viewer) || canManageOperations(viewer) || viewer.id === people.leadId || viewer.id === people.backupId;
  if (!allowed) throw new ForbiddenError("Alleen de operationeel verantwoordelijke en de eigenaar kunnen dit.");
  return viewer;
}

/** Nu controleren (zonder meldingen): taken en statussen direct bijwerken. */
export async function runOpsControlNow(): Promise<Result> {
  try {
    const viewer = await requireLeadOrOps();
    const r = await runOpsControl({ slot: "handmatig", triggeredById: viewer.id });
    revalidatePath("/dashboard");
    revalidatePath("/tasks");
    if (!r.ok) return { ok: false, message: "De controle is niet volledig gelukt. Zie Systeemstatus voor het logboek." };
    const s = r.summary!;
    return { ok: true, message: `${s.open} open · ${s.created} nieuw · ${s.resolvedAuto} opgelost` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Zone C: een punt dat de operationeel verantwoordelijke niet zelf mag oplossen naar Jarno. */
export async function escalateToJarno(itemId: string, reason: string): Promise<Result> {
  try {
    const viewer = await requireLeadOrOps();
    if (reason.trim().length < 10) return { ok: false, message: "Beschrijf kort het probleem en je voorstel (minimaal een zin)." };
    await escalateItemToJarno(itemId, reason.trim(), viewer.fullName.split(" ")[0] ?? viewer.fullName);
    await auditLog({ viewer, action: "ops_control.escalated_to_jarno", entityType: "ops_control_item", entityId: itemId, changes: { reason } });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateOpsSettings(input: OpsControlSettings): Promise<Result> {
  try {
    const viewer = await requirePermission("settings:write");
    const before = await getOpsSettings();
    await saveOpsSettings(input, viewer.id);
    await auditLog({ viewer, action: "settings.ops_control_updated", entityType: "setting", entityId: "opscontrol", changes: { before, after: input } });
    revalidatePath("/settings/operationele-controle");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
