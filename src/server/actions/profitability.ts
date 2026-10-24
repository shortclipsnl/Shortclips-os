"use server";

import { revalidatePath } from "next/cache";
import { requireOwner, ForbiddenError } from "@/server/auth/context";
import { setProfitSettings } from "@/server/profit-settings";

export type ActionResult = { ok: boolean; message?: string };

/** Grenswaarden voor winstgevendheid bijwerken (alleen eigenaar). */
export async function updateProfitSettings(input: {
  marginGreenPct?: number;
  marginOrangePct?: number;
  includeOverhead?: boolean;
}): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    await setProfitSettings(input, viewer.id);
    revalidatePath("/winstgevendheid");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
