"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { captionItems, captionSets, clients, productionDays, shootScriptSources } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { ensureCaptionsForShoot } from "@/server/captions/run";
import { shootReviewPdf } from "@/server/captions/generate";
import { matchDriveScriptsForShoots } from "@/server/captions/drive-script-match";
import { regenerateOneCaption } from "@/server/actions/ai-tools";

export type CaptionActionResult = { ok: boolean; message?: string };

/** Laadt een caption-item met de klant van de bijbehorende opname (voor scope). */
async function loadItem(itemId: string) {
  const [row] = await db
    .select({
      id: captionItems.id,
      position: captionItems.position,
      shortTitle: captionItems.shortTitle,
      hook: captionItems.hook,
      setId: captionSets.id,
      clientId: captionSets.clientId,
      productionDayId: captionSets.productionDayId,
    })
    .from(captionItems)
    .innerJoin(captionSets, eq(captionSets.id, captionItems.captionSetId))
    .where(eq(captionItems.id, itemId))
    .limit(1);
  return row ?? null;
}

/** Controleert de klanttoegang voor een opname en geeft de klant-id terug. */
async function shootClientId(productionDayId: string): Promise<string | null> {
  const [d] = await db
    .select({ clientId: productionDays.clientId })
    .from(productionDays)
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  return d?.clientId ?? null;
}

/** Handmatig alle captions van een opname (opnieuw) genereren. */
export async function regenerateShootCaptions(productionDayId: string): Promise<CaptionActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    const clientId = await shootClientId(productionDayId);
    if (!clientId) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, clientId);

    const res = await ensureCaptionsForShoot(productionDayId, { force: true });
    revalidatePath(`/ai/caption/opname/${productionDayId}`);
    revalidatePath("/ai/caption");
    if (res.ok) return { ok: true };
    if (res.reason === "no_pdf") return { ok: false, message: "Er staat nog geen scriptcontrole-PDF klaar voor deze opname." };
    return { ok: false, message: res.message ?? "Genereren mislukt." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Eén caption opnieuw genereren (overschrijft alleen dat item). */
export async function regenerateCaptionItem(
  itemId: string,
  variant?: "variatie" | "met_cta" | "zonder_cta" | "korter" | "langer",
): Promise<CaptionActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    const item = await loadItem(itemId);
    if (!item) return { ok: false, message: "Caption niet gevonden." };
    assertClientAccess(viewer, item.clientId);

    const pdf = await shootReviewPdf(item.productionDayId);
    const res = await regenerateOneCaption({
      clientId: item.clientId,
      shortTitle: item.shortTitle,
      hook: item.hook,
      pdfBase64: pdf?.pdfBase64,
      variant,
    });
    if (!res.ok) return { ok: false, message: res.message };

    await db
      .update(captionItems)
      .set({
        shortTitle: res.data.shortTitle || item.shortTitle,
        hook: res.data.hook || item.hook,
        caption: res.data.caption,
        hashtags: res.data.hashtags ?? [],
        status: "gegenereerd",
        isEdited: false,
        staleFromNewVersion: false,
        updatedAt: new Date(),
      })
      .where(eq(captionItems.id, itemId));
    revalidatePath(`/ai/caption/opname/${item.productionDayId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Handmatige bewerking opslaan (auto-save). Markeert het item als bewerkt. */
export async function updateCaptionItem(itemId: string, caption: string): Promise<CaptionActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    const item = await loadItem(itemId);
    if (!item) return { ok: false, message: "Caption niet gevonden." };
    assertClientAccess(viewer, item.clientId);

    await db
      .update(captionItems)
      .set({ caption, isEdited: true, status: "bewerkt", staleFromNewVersion: false, updatedAt: new Date() })
      .where(eq(captionItems.id, itemId));
    revalidatePath(`/ai/caption/opname/${item.productionDayId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** De captions van een opname als gecontroleerd markeren. */
export async function markShootCaptionsChecked(productionDayId: string): Promise<CaptionActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    const clientId = await shootClientId(productionDayId);
    if (!clientId) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, clientId);

    const res = await db
      .update(captionSets)
      .set({ status: "gecontroleerd", checkedById: viewer.id, checkedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(captionSets.productionDayId, productionDayId), isNull(captionSets.deletedAt)))
      .returning({ id: captionSets.id });
    if (res.length === 0) return { ok: false, message: "Er zijn nog geen captions om te controleren." };
    revalidatePath(`/ai/caption/opname/${productionDayId}`);
    revalidatePath("/ai/caption");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Een automatische Drive-koppeling die als "suggestie" stond, bevestigen: de
 * script-PDF wordt de bron en de captions worden meteen voorbereid.
 */
export async function confirmDriveScriptSource(productionDayId: string): Promise<CaptionActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    const clientId = await shootClientId(productionDayId);
    if (!clientId) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, clientId);

    const res = await db
      .update(shootScriptSources)
      .set({ status: "gekoppeld", confirmedAt: new Date(), confirmedById: viewer.id, updatedAt: new Date() })
      .where(eq(shootScriptSources.productionDayId, productionDayId))
      .returning({ id: shootScriptSources.id });
    if (res.length === 0) return { ok: false, message: "Geen Drive-suggestie gevonden voor deze opname." };

    // Captions meteen voorbereiden op basis van de bevestigde PDF.
    try { await ensureCaptionsForShoot(productionDayId); } catch { /* cron vangt dit op */ }
    revalidatePath("/ai/caption");
    revalidatePath(`/ai/caption/opname/${productionDayId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Een onjuiste Drive-suggestie afwijzen (wordt niet opnieuw voorgesteld). */
export async function dismissDriveScriptSource(productionDayId: string): Promise<CaptionActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    const clientId = await shootClientId(productionDayId);
    if (!clientId) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, clientId);

    await db
      .update(shootScriptSources)
      .set({ status: "afgewezen", confirmedAt: null, confirmedById: null, updatedAt: new Date() })
      .where(eq(shootScriptSources.productionDayId, productionDayId));
    revalidatePath("/ai/caption");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Handmatig nu in Drive zoeken naar de bijbehorende script-PDF voor één opname
 * (zonder op de achtergrond-cron te wachten). Koppelt zeker, of zet een suggestie.
 */
export async function findDriveScriptForShoot(productionDayId: string): Promise<CaptionActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    const [day] = await db
      .select({
        id: productionDays.id,
        clientId: productionDays.clientId,
        scheduledOn: productionDays.scheduledOn,
        title: productionDays.title,
        clientName: clients.name,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
      .limit(1);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    const [outcome] = await matchDriveScriptsForShoots([
      { productionDayId: day.id, clientId: day.clientId, scheduledOn: day.scheduledOn, title: day.title, clientName: day.clientName },
    ]);
    if (outcome?.linked) {
      try { await ensureCaptionsForShoot(productionDayId); } catch { /* cron vangt dit op */ }
      revalidatePath("/ai/caption");
      return { ok: true, message: "Script uit Drive gekoppeld; captions worden voorbereid." };
    }
    if (outcome?.suggested) {
      revalidatePath("/ai/caption");
      return { ok: true, message: "Mogelijke match gevonden — bevestig de suggestie." };
    }
    return { ok: false, message: "Geen bijbehorende script-PDF in Drive gevonden." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
