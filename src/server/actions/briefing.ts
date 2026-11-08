"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { briefingSets } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requireEditingManager } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { isStoreV2, type BriefingOverrides } from "@/server/briefing/types";

export type BriefingActionResult = { ok: boolean; message?: string };

const highlightSchema = z.object({
  categorie: z.string().trim().min(1).max(32),
  tekst: z.string().trim().min(3).max(240),
  niet: z.boolean(),
  kritiek: z.boolean(),
});

const overridesSchema = z.object({
  productionDayId: z.string().uuid(),
  /** null = terug naar de automatische highlights uit de guide. */
  highlights: z.array(highlightSchema).max(7).nullable().optional(),
  coverAssetId: z.string().uuid().nullable().optional(),
});

/**
 * Handmatige correctie van de briefing door Team Shortclips. Wordt apart van de
 * automatische inhoud bewaard, zodat een automatische update (nieuw script of
 * nieuwe guide) de correctie nooit overschrijft. Editors kunnen dit niet.
 * Scripts, links en deadlines corrigeer je bij de bron (script-PDF, project).
 */
export async function saveBriefingOverrides(input: z.input<typeof overridesSchema>): Promise<BriefingActionResult> {
  try {
    const viewer = await requireEditingManager();
    const data = overridesSchema.parse(input);
    const [set] = await db
      .select({ id: briefingSets.id, clientId: briefingSets.clientId, content: briefingSets.content })
      .from(briefingSets)
      .where(and(eq(briefingSets.productionDayId, data.productionDayId), isNull(briefingSets.deletedAt)))
      .limit(1);
    if (!set || !isStoreV2(set.content)) return { ok: false, message: "Er is nog geen briefing om te corrigeren." };
    assertClientAccess(viewer, set.clientId);

    const prev: BriefingOverrides = set.content.overrides ?? {};
    const next: BriefingOverrides = { ...prev, updatedAt: new Date().toISOString(), updatedBy: viewer.fullName || viewer.email };
    if (data.highlights !== undefined) {
      next.highlights = data.highlights && data.highlights.length ? data.highlights : null;
      next.highlightsGuideHash = next.highlights ? set.content.guide.hash : null;
    }
    if (data.coverAssetId !== undefined) next.coverAssetId = data.coverAssetId;

    // Alleen het overrides-veld wijzigen (jsonb_set), zodat een gelijktijdige
    // automatische update van scripts/guide niets kwijtraakt.
    await db.execute(
      sql`update briefing_sets set content = jsonb_set(content, '{overrides}', ${JSON.stringify(next)}::jsonb, true), updated_at = now() where id = ${set.id}`,
    );
    await auditLog({ viewer, action: "briefing.corrected", entityType: "briefing_set", entityId: set.id, clientId: set.clientId }).catch(() => undefined);
    revalidatePath(`/briefing/${data.productionDayId}`);
    return { ok: true, message: "Correctie opgeslagen. Die blijft staan bij automatische updates." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    if (error instanceof z.ZodError) return { ok: false, message: "Controleer de ingevulde richtlijnen." };
    throw error;
  }
}

/** Briefing direct opnieuw opbouwen (bijv. na het vervangen van de script-PDF). */
export async function refreshBriefing(productionDayId: string): Promise<BriefingActionResult> {
  try {
    await requireEditingManager();
    if (!z.string().uuid().safeParse(productionDayId).success) return { ok: false, message: "Onbekende opname." };
    const { ensureBriefingForShoot } = await import("@/server/briefing/run");
    const res = await ensureBriefingForShoot(productionDayId, { force: true });
    revalidatePath(`/briefing/${productionDayId}`);
    if (res.ok) return { ok: true, message: "Briefing bijgewerkt." };
    if (res.reason === "no_pdf") return { ok: false, message: "Er staat nog geen script-PDF klaar voor deze opname." };
    return { ok: false, message: res.message ?? "Bijwerken mislukt." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
