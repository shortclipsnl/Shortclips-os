"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requirePermission } from "@/server/auth/context";
import { savePortalSettings, type PortalSettings } from "@/server/portal-settings";

export type ActionResult = { ok: boolean; message?: string };

const clampDay = (n: unknown) => Math.max(0, Math.min(60, Math.round(Number(n) || 0)));
const str = (v: unknown, max = 400) => String(v ?? "").trim().slice(0, max);

/** Intern: de klantportaal-termijnen en -voorwaarden aanpassen (owner + coördinatoren). */
export async function updatePortalSettings(input: PortalSettings): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const clean: PortalSettings = {
      feedbackDaysScripts: clampDay(input.feedbackDaysScripts),
      feedbackDaysVideos: clampDay(input.feedbackDaysVideos),
      cancelNoticeDays: clampDay(input.cancelNoticeDays),
      cancelFee: str(input.cancelFee, 120),
      cancelLateNote: str(input.cancelLateNote, 400),
      reshootFee: str(input.reshootFee, 200),
      extraFeedbackFee: str(input.extraFeedbackFee, 200),
      travelCost: str(input.travelCost, 120),
      responseTime: str(input.responseTime, 200),
    };
    await savePortalSettings(clean, viewer.id);
    revalidatePath("/settings/portaal");
    revalidatePath("/portal/samenwerking");
    revalidatePath("/portal/scripts");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
