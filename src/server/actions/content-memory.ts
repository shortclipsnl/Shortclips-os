"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { refreshContentMemoryAi } from "@/server/content-memory";

export type MemoryActionResult = { ok: true; message: string } | { ok: false; message: string };

/** "Nu bijwerken": formats en ideeën direct opnieuw laten bepalen (normaal gebeurt dit 's nachts). */
export async function refreshContentMemoryAction(clientId: string): Promise<MemoryActionResult> {
  try {
    const viewer = await requirePermission("analytics:read");
    assertClientAccess(viewer, clientId);
    const { backfillThumbnails } = await import("@/server/content-memory/thumbnails");
    await backfillThumbnails({ clientId, budgetMs: 40_000 }).catch(() => null);
    const res = await refreshContentMemoryAi(clientId, { force: true });
    revalidatePath("/contentgeheugen");
    return res.ok
      ? { ok: true, message: res.labeled ? `${res.labeled} video's van een format voorzien.` : "Bijgewerkt." }
      : { ok: false, message: res.reason ?? "Bijwerken lukte niet." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    return { ok: false, message: "Bijwerken lukte niet." };
  }
}

export type HookAltsResult =
  | { ok: true; items: Record<string, import("@/server/content-memory/hook-alternatives").HookAlternatives> }
  | { ok: false; message: string };

/**
 * Alternatieve hooks aanvullen (ontbrekende) of voor één hook opnieuw laten
 * maken. Normaal gebeurt dit 's nachts; de pagina vraagt het alleen aan als
 * er voor een getoonde hook nog niets klaarstaat.
 */
export async function hookAlternativesAction(clientId: string, forceKey?: string): Promise<HookAltsResult> {
  try {
    const viewer = await requirePermission("analytics:read");
    assertClientAccess(viewer, clientId);
    const { getContentMemory } = await import("@/server/content-memory");
    const { generateHookAlternatives, getHookAlternatives } = await import("@/server/content-memory/hook-alternatives");
    const cm = await getContentMemory(viewer, clientId);
    if (!cm) return { ok: false, message: "Klant niet gevonden." };
    const res = await generateHookAlternatives(clientId, cm.memory, { forceKeys: forceKey ? [forceKey] : [] });
    if (!res.ok) return { ok: false, message: res.reason ?? "Genereren lukte niet." };
    return { ok: true, items: await getHookAlternatives(clientId) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    return { ok: false, message: "Genereren lukte niet." };
  }
}

/**
 * Omslagen van deze klant aanvullen (ontbrekend of te klein) uit Metricool.
 * Draait ook 's nachts; de pagina roept dit aan zodra er een video zonder
 * omslag zichtbaar is, zodat lege kaarten zichzelf herstellen.
 */
export async function backfillThumbnailsAction(clientId: string): Promise<{ ok: boolean; updated: number }> {
  try {
    const viewer = await requirePermission("analytics:read");
    assertClientAccess(viewer, clientId);
    const { backfillThumbnails } = await import("@/server/content-memory/thumbnails");
    const { clearContentMemoryCache } = await import("@/server/content-memory");
    const res = await backfillThumbnails({ clientId, budgetMs: 45_000 });
    if (res.updated) {
      clearContentMemoryCache(clientId);
      revalidatePath("/contentgeheugen");
    }
    return { ok: true, updated: res.updated };
  } catch {
    return { ok: false, updated: 0 };
  }
}
