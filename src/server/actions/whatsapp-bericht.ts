"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables } from "@/db/schema";
import { ForbiddenError, assertClientAccess, canManageOperations, requireInternal } from "@/server/auth/context";
import { setStringSetting } from "@/server/app-settings";
import { auditLog } from "@/server/audit";
import { canUseWhatsappBericht } from "@/server/whatsapp-bericht-access";
import {
  DEFAULT_WHATSAPP_BERICHT,
  WHATSAPP_BERICHT_MAX_LENGTH,
  WHATSAPP_OPTIE_META,
  WHATSAPP_SETTING_KEYS,
  normalizeBericht,
  sanitizeConcept,
  type WhatsappBerichtConcept,
  type WhatsappOptie,
} from "@/lib/whatsapp-bericht";

type Result = { ok: true } | { ok: false; message: string };

async function loadOpname(videoId: string) {
  const [row] = await db
    .select({ id: deliverables.id, clientId: deliverables.clientId, concept: deliverables.whatsappBericht })
    .from(deliverables)
    .where(eq(deliverables.id, videoId))
    .limit(1);
  return row;
}

async function guard(videoId: string) {
  const viewer = await requireInternal();
  if (!canUseWhatsappBericht(viewer)) throw new ForbiddenError("Alleen het kantoorteam kan klantberichten voorbereiden.");
  const opname = await loadOpname(videoId);
  if (!opname) throw new ForbiddenError("Opname niet gevonden.");
  assertClientAccess(viewer, opname.clientId);
  return { viewer, opname };
}

/**
 * Concept van het WhatsApp-bericht bij deze opname bewaren (optie, videolink,
 * aangepaste tekst, checklist). Geldt alleen voor deze opname; de standaardtekst
 * voor andere medewerkers verandert niet. Het kopieermoment blijft behouden.
 */
export async function saveWhatsappConcept(videoId: string, input: unknown): Promise<Result> {
  try {
    const { opname } = await guard(videoId);
    const next = sanitizeConcept(input);
    next.gekopieerd = sanitizeConcept(opname.concept).gekopieerd;
    await db.update(deliverables).set({ whatsappBericht: next }).where(eq(deliverables.id, videoId));
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Kopieermoment vastleggen, zodat het team op de rij ziet dat het bericht klaarstaat. */
export async function markWhatsappGekopieerd(videoId: string, optie: WhatsappOptie, input: unknown): Promise<Result & { at?: string }> {
  try {
    const { viewer, opname } = await guard(videoId);
    if (optie !== "videolink" && optie !== "portaal") return { ok: false, message: "Onbekende optie." };
    const at = new Date().toISOString();
    const next: WhatsappBerichtConcept = sanitizeConcept(input);
    next.optie = optie;
    next.gekopieerd = { ...sanitizeConcept(opname.concept).gekopieerd, [optie]: at };
    await db.update(deliverables).set({ whatsappBericht: next }).where(eq(deliverables.id, videoId));
    try {
      await auditLog({
        viewer,
        action: "videos.whatsapp_bericht_gekopieerd",
        entityType: "deliverable",
        entityId: videoId,
        clientId: opname.clientId,
        changes: { optie: WHATSAPP_OPTIE_META[optie].label },
      });
    } catch (e) {
      console.error("[whatsapp-bericht] auditlog mislukt", e);
    }
    revalidatePath("/videos");
    return { ok: true, at };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Standaardtekst van een optie voor alle medewerkers wijzigen of herstellen.
 * Alleen beheerders (eigenaar en operationeel beheerder).
 */
export async function updateWhatsappStandaard(optie: WhatsappOptie, text: string, opts: { reset?: boolean } = {}): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    const viewer = await requireInternal();
    if (!canManageOperations(viewer)) throw new ForbiddenError("Alleen beheerders kunnen de standaardtekst aanpassen.");
    if (optie !== "videolink" && optie !== "portaal") return { ok: false, message: "Onbekende optie." };
    const next = opts.reset ? DEFAULT_WHATSAPP_BERICHT[optie] : normalizeBericht(String(text ?? ""));
    if (!next) return { ok: false, message: "Het bericht mag niet leeg zijn." };
    if (next.length > WHATSAPP_BERICHT_MAX_LENGTH) return { ok: false, message: `Het bericht is te lang (max. ${WHATSAPP_BERICHT_MAX_LENGTH} tekens).` };
    await setStringSetting(WHATSAPP_SETTING_KEYS[optie], next, {
      category: "editing",
      description: `Standaard WhatsApp-bericht eerste versies: ${WHATSAPP_OPTIE_META[optie].label}`,
      updatedById: viewer.id,
    });
    try {
      await auditLog({ viewer, action: "settings.whatsapp_bericht_updated", entityType: "setting", changes: { key: WHATSAPP_SETTING_KEYS[optie], reset: Boolean(opts.reset) } });
    } catch (e) {
      console.error("[whatsapp-bericht] auditlog mislukt", e);
    }
    revalidatePath("/videos");
    return { ok: true, text: next };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
