"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { SCRIPTING_ORDER } from "@/lib/statuses";
import { notify, clearByDedupe } from "@/server/notifications";

export type ActionResult = { ok: boolean; message?: string };

/** Status waarop een script op controle bij Jarno (de owner) staat. */
const CONTROLE_JARNO = "controle_jarno";

/** Scriptingstatus van een opnamedag wijzigen (één klik, Monday-stijl). */
export async function setScriptingStatus(productionDayId: string, status: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    if (!(SCRIPTING_ORDER as readonly string[]).includes(status)) {
      return { ok: false, message: "Onbekende scriptingstatus." };
    }
    const [day] = await db
      .select({
        id: productionDays.id,
        clientId: productionDays.clientId,
        prevStatus: productionDays.scriptingStatus,
        clientName: clients.name,
        clientSlug: clients.slug,
      })
      .from(productionDays)
      .leftJoin(clients, eq(clients.id, productionDays.clientId))
      .where(eq(productionDays.id, productionDayId))
      .limit(1);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    await db.update(productionDays).set({ scriptingStatus: status, updatedAt: new Date() }).where(eq(productionDays.id, productionDayId));

    // Automatische controle-melding voor Jarno (de owner). De dedupe-sleutel is
    // per opname (zonder datum), zodat er nooit dubbele meldingen ontstaan en de
    // melding blijft staan zolang het script op controle wacht.
    const dedupeKey = `scripting_controle:${productionDayId}`;
    if (status === CONTROLE_JARNO && day.prevStatus !== CONTROLE_JARNO) {
      // Eerst een eventuele oude (gelezen) melding opruimen, dan vers aanmaken —
      // zo komt de melding ook terug als een script opnieuw op controle belandt.
      await clearByDedupe(dedupeKey);
      await notify({
        roles: ["owner"],
        clientId: day.clientId,
        type: "scripting_controle",
        level: "warning",
        title: "Script klaar voor controle",
        body: `Het script van ${day.clientName ?? "een klant"} staat klaar voor jouw controle.`,
        href: "/scripting?status=controle_jarno",
        entityType: "production_day",
        entityId: productionDayId,
        dedupeKey,
      });
    } else if (status !== CONTROLE_JARNO && day.prevStatus === CONTROLE_JARNO) {
      // Script is gecontroleerd / kreeg een andere status → melding weghalen.
      await clearByDedupe(dedupeKey);
    }

    revalidatePath("/scripting");
    revalidatePath("/notifications");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Notitie bij de scriptingstatus zetten of wissen (wat er nog moet gebeuren). */
export async function setScriptingNote(productionDayId: string, note: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const [day] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId })
      .from(productionDays)
      .where(eq(productionDays.id, productionDayId))
      .limit(1);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    const trimmed = note.trim().slice(0, 500);
    await db
      .update(productionDays)
      .set({ scriptingNote: trimmed || null, updatedAt: new Date() })
      .where(eq(productionDays.id, productionDayId));
    revalidatePath("/scripting");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Verantwoordelijke scriptschrijver van een opname zetten of wissen. */
export async function setScriptWriter(productionDayId: string, writerId: string | null): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const [day] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId })
      .from(productionDays)
      .where(eq(productionDays.id, productionDayId))
      .limit(1);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    await db.update(productionDays).set({ scriptWriterId: writerId, updatedAt: new Date() }).where(eq(productionDays.id, productionDayId));
    revalidatePath("/scripting");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
