"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, productionDays } from "@/db/schema";
import { requireOwner, ForbiddenError } from "@/server/auth/context";
import { addWorkingDays } from "@/lib/workdays";

export type ActionResult = { ok: boolean; message?: string; count?: number };

function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

async function shootDate(productionDayId: string): Promise<string | null> {
  const [d] = await db.select({ on: productionDays.scheduledOn }).from(productionDays).where(eq(productionDays.id, productionDayId)).limit(1);
  return d?.on ?? null;
}

/** Een video definitief aan een opnamedag koppelen + (auto) deadline zetten. */
async function applyLink(deliverableId: string, productionDayId: string): Promise<void> {
  const [v] = await db
    .select({ dueOnSource: deliverables.dueOnSource })
    .from(deliverables)
    .where(eq(deliverables.id, deliverableId))
    .limit(1);
  const on = await shootDate(productionDayId);
  // Automatische deadline = opnamedatum + 14 werkdagen (SOP), tenzij handmatig vastgezet.
  const dueOn = on && v?.dueOnSource !== "manual" ? addWorkingDays(on, 14) : undefined;
  await db
    .update(deliverables)
    .set({
      productionDayId,
      suggestedProductionDayId: null,
      linkConfidence: null,
      linkReviewed: true,
      ...(dueOn ? { dueOn } : {}),
      updatedAt: new Date(),
    })
    .where(eq(deliverables.id, deliverableId));
}

/** Voorgestelde koppeling bevestigen. */
export async function confirmLink(deliverableId: string): Promise<ActionResult> {
  return wrap(async () => {
    await requireOwner();
    const [v] = await db
      .select({ suggested: deliverables.suggestedProductionDayId })
      .from(deliverables)
      .where(eq(deliverables.id, deliverableId))
      .limit(1);
    if (!v?.suggested) return { ok: false, message: "Geen voorstel om te bevestigen." };
    await applyLink(deliverableId, v.suggested);
    revalidatePath("/koppelingen");
    return { ok: true };
  });
}

/** Voorstel afwijzen — video blijft ongekoppeld, komt niet terug als suggestie. */
export async function rejectLink(deliverableId: string): Promise<ActionResult> {
  return wrap(async () => {
    await requireOwner();
    await db
      .update(deliverables)
      .set({ suggestedProductionDayId: null, linkConfidence: null, linkReviewed: true, updatedAt: new Date() })
      .where(eq(deliverables.id, deliverableId));
    revalidatePath("/koppelingen");
    return { ok: true };
  });
}

/** Handmatig koppelen aan een gekozen opnamedag (alleen binnen dezelfde klant). */
export async function setManualLink(deliverableId: string, productionDayId: string): Promise<ActionResult> {
  return wrap(async () => {
    await requireOwner();
    const [v] = await db.select({ clientId: deliverables.clientId }).from(deliverables).where(eq(deliverables.id, deliverableId)).limit(1);
    const [d] = await db.select({ clientId: productionDays.clientId }).from(productionDays).where(eq(productionDays.id, productionDayId)).limit(1);
    if (!v || !d) return { ok: false, message: "Video of opname niet gevonden." };
    if (v.clientId !== d.clientId) return { ok: false, message: "De opname hoort bij een andere klant." };
    await applyLink(deliverableId, productionDayId);
    revalidatePath("/koppelingen");
    return { ok: true };
  });
}

/**
 * Alle openstaande suggesties met hoge zekerheid in één keer bevestigen.
 * Elk krijgt dezelfde automatische deadline als bij losse bevestiging.
 * Lage/gemiddelde suggesties blijven staan voor handmatige controle.
 */
export async function confirmHighConfidenceLinks(): Promise<ActionResult> {
  return wrap(async () => {
    await requireOwner();
    const rows = await db
      .select({ id: deliverables.id, suggested: deliverables.suggestedProductionDayId })
      .from(deliverables)
      .where(
        and(
          isNull(deliverables.deletedAt),
          isNull(deliverables.productionDayId),
          isNotNull(deliverables.suggestedProductionDayId),
          eq(deliverables.linkReviewed, false),
          eq(deliverables.linkConfidence, "high"),
        ),
      );
    let count = 0;
    for (const r of rows) {
      if (!r.suggested) continue;
      await applyLink(r.id, r.suggested);
      count++;
    }
    revalidatePath("/koppelingen");
    return { ok: true, count };
  });
}
