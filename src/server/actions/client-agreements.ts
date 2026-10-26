"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clientAgreementOverrides, clients } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { OVERRIDABLE_KEYS, type PortalSettings } from "@/server/portal-settings";

export type ActionResult = { ok: boolean; message?: string };

const NUMBER_KEYS = new Set<keyof PortalSettings>(["feedbackDaysScripts", "feedbackDaysVideos", "cancelNoticeDays", "reviewDays", "reviewAutoApproveDays"]);
const clampDay = (n: unknown) => Math.max(0, Math.min(60, Math.round(Number(n) || 0)));

/**
 * Klantspecifieke afspraken-overrides opslaan (intern). Alleen de velden die
 * echt afwijken worden bewaard; lege waarden vallen terug op de algemene
 * afspraak. Dit is een informatieve weergave in het portaal — geen wijziging
 * van de overeenkomst zelf.
 */
export async function saveClientAgreementOverrides(clientId: string, input: Partial<Record<keyof PortalSettings, string | number>>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("clients:write");
    assertClientAccess(viewer, clientId);

    const overrides: Partial<PortalSettings> = {};
    for (const k of OVERRIDABLE_KEYS) {
      const v = input[k];
      if (v === undefined || v === null || String(v).trim() === "") continue; // leeg = algemeen
      if (NUMBER_KEYS.has(k)) overrides[k] = clampDay(v) as never;
      else overrides[k] = String(v).trim().slice(0, 600) as never;
    }

    await db
      .insert(clientAgreementOverrides)
      .values({ clientId, overrides, updatedById: viewer.id })
      .onConflictDoUpdate({ target: clientAgreementOverrides.clientId, set: { overrides, updatedById: viewer.id, updatedAt: new Date() } });

    await auditLog({ viewer, action: "client_agreements.saved", entityType: "client", entityId: clientId, clientId, changes: { fields: Object.keys(overrides) } });

    const [c] = await db.select({ slug: clients.slug }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (c) revalidatePath(`/clients/${c.slug}`);
    revalidatePath("/portal/samenwerking");
    revalidatePath("/portal/scripts");
    revalidatePath("/portal/planning");
    revalidatePath("/portal/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
