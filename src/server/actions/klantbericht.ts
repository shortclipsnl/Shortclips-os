"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, canManageOperations, requireInternal } from "@/server/auth/context";
import { setStringSetting } from "@/server/app-settings";
import { auditLog } from "@/server/audit";
import { DEFAULT_KLANTBERICHT, KLANTBERICHT_MAX_LENGTH, KLANTBERICHT_SETTING_KEY, normalizeKlantbericht } from "@/lib/klantbericht";

type Result = { ok: true; text: string } | { ok: false; message: string };

/**
 * Standaard klantbericht centraal aanpassen. Alleen beheerders (eigenaar en
 * operationeel beheerder); de nieuwe tekst geldt direct voor alle medewerkers.
 * `reset` zet de tekst terug naar de standaardversie.
 */
export async function updateKlantbericht(text: string, opts: { reset?: boolean } = {}): Promise<Result> {
  try {
    const viewer = await requireInternal();
    if (!canManageOperations(viewer)) throw new ForbiddenError("Alleen beheerders kunnen het standaard klantbericht aanpassen.");
    const next = opts.reset ? DEFAULT_KLANTBERICHT : normalizeKlantbericht(String(text ?? ""));
    if (!next) return { ok: false, message: "Het bericht mag niet leeg zijn." };
    if (next.length > KLANTBERICHT_MAX_LENGTH) return { ok: false, message: `Het bericht is te lang (max. ${KLANTBERICHT_MAX_LENGTH} tekens).` };
    await setStringSetting(KLANTBERICHT_SETTING_KEY, next, {
      category: "editing",
      description: "Standaard klantbericht bij de eerste versies (Editing → Kopieer klantbericht)",
      updatedById: viewer.id,
    });
    await auditLog({ viewer, action: "settings.klantbericht_updated", entityType: "setting", entityId: KLANTBERICHT_SETTING_KEY, changes: { reset: Boolean(opts.reset), length: next.length } });
    revalidatePath("/videos");
    return { ok: true, text: next };
  } catch (error) {
    if (error instanceof Error) return { ok: false, message: error.message };
    throw error;
  }
}
