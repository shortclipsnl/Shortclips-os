"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { syncClientMomentTasks, updateMomentData } from "@/server/klantmomenten";

export type MomentFormInput = {
  startEstimate: string | null;
  foundedOn: string | null;
  foundedYear: number | null;
  foundedSource: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v: string | null | undefined) => (v && DATE.test(v.trim()) ? v.trim() : null);

/** Momentgegevens van een klant opslaan (blok Momenten op de klantpagina). */
export async function saveClientMoments(clientId: string, input: MomentFormInput): Promise<{ ok: boolean; message?: string }> {
  try {
    const viewer = await requirePermission("clients:write");
    const [existing] = await db.select({ id: clients.id, slug: clients.slug }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
    if (!existing) return { ok: false, message: "Klant niet gevonden." };
    assertClientAccess(viewer, existing.id);

    const foundedOn = cleanDate(input.foundedOn);
    const year = foundedOn ? Number(foundedOn.slice(0, 4)) : input.foundedYear;
    const thisYear = new Date().getFullYear();
    if (year != null && (!Number.isInteger(year) || year < 1800 || year > thisYear)) {
      return { ok: false, message: "Vul een geldig oprichtingsjaar in." };
    }
    const patch = {
      startEstimate: cleanDate(input.startEstimate),
      foundedOn,
      foundedYear: year ?? null,
      foundedSource: input.foundedSource?.trim() || null,
    };
    await updateMomentData(existing.id, patch, viewer.id);
    await auditLog({ viewer, action: "client.set_moments", entityType: "client", entityId: existing.id, clientId: existing.id, changes: patch });
    // Valt een moment door de wijziging binnen een week, dan staat de taak er meteen.
    await syncClientMomentTasks();
    revalidatePath(`/clients/${existing.slug}`);
    revalidatePath("/tasks");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
