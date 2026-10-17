"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { videoAnalyses, videoAnalysisSteps, videoHooks, publications } from "@/db/schema";
import { requirePermission, assertClientAccess, hasClientAccess, ForbiddenError } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { runPipeline } from "@/server/video-intelligence/pipeline";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; message: string };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof ForbiddenError) return { ok: false, message: e.message };
  throw e;
}

/** Leidt het platform af uit een publieke URL. */
function detectPlatform(url: string): "tiktok" | "instagram" | "youtube" | null {
  const u = url.toLowerCase();
  if (u.includes("tiktok.")) return "tiktok";
  if (u.includes("instagram.")) return "instagram";
  if (u.includes("youtube.") || u.includes("youtu.be")) return "youtube";
  return null;
}

/** Voeg een video toe via een publieke platform-URL en start de analyse. */
export async function addVideoByUrl(input: { clientId: string; url: string; title?: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const viewer = await requirePermission("video_intelligence:run");
    assertClientAccess(viewer, input.clientId);

    const url = input.url.trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, message: "Geef een geldige https-URL." };

    // Dedup: zelfde bron bij dezelfde klant → bestaande analyse teruggeven.
    const [dup] = await db.select({ id: videoAnalyses.id }).from(videoAnalyses)
      .where(and(eq(videoAnalyses.clientId, input.clientId), eq(videoAnalyses.sourceUrl, url))).limit(1);
    if (dup) return { ok: true, data: { id: dup.id } };

    // Prestatie-koppeling: matcht deze URL een gepubliceerde video, dan koppelen
    // we de publicatie/deliverable zodat de echte cijfers beschikbaar komen.
    const [pub] = await db
      .select({ id: publications.id, deliverableId: publications.deliverableId })
      .from(publications)
      .where(and(eq(publications.externalUrl, url), eq(publications.clientId, input.clientId)))
      .limit(1);

    const [created] = await db.insert(videoAnalyses).values({
      clientId: input.clientId,
      title: input.title?.trim() || null,
      platform: detectPlatform(url),
      sourceType: "platform_url",
      sourceUrl: url,
      publicationId: pub?.id ?? null,
      deliverableId: pub?.deliverableId ?? null,
      status: "queued",
      createdById: viewer.id,
    }).returning({ id: videoAnalyses.id });

    const id = created!.id;
    await db.insert(videoAnalysisSteps).values(
      (["download", "probe", "shots", "editing", "ocr", "transcribe", "vision", "insights"] as const).map((step) => ({ analysisId: id, step })),
    );
    await auditLog({ viewer, action: "video_intelligence.add", entityType: "video_analysis", entityId: id, clientId: input.clientId });

    // Verwerking start in de achtergrond (in-proces).
    void runPipeline(id).catch(() => {});
    revalidatePath("/video-intelligence");
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(e);
  }
}

/** Opnieuw verwerken (bijv. nadat ffmpeg/keys zijn geïnstalleerd). */
export async function reprocessAnalysis(id: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("video_intelligence:run");
    const [a] = await db.select({ clientId: videoAnalyses.clientId }).from(videoAnalyses).where(eq(videoAnalyses.id, id)).limit(1);
    if (!a) return { ok: false, message: "Analyse niet gevonden." };
    assertClientAccess(viewer, a.clientId);

    await db.delete(videoAnalysisSteps).where(eq(videoAnalysisSteps.analysisId, id));
    await db.insert(videoAnalysisSteps).values(
      (["download", "probe", "shots", "editing", "ocr", "transcribe", "vision", "insights"] as const).map((step) => ({ analysisId: id, step })),
    );
    await db.update(videoAnalyses).set({ status: "queued", error: null, updatedAt: new Date() }).where(eq(videoAnalyses.id, id));
    void runPipeline(id).catch(() => {});
    revalidatePath(`/video-intelligence/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Meerdere analyses in één keer opnieuw verwerken. */
export async function reprocessMany(ids: string[]): Promise<ActionResult<{ count: number }>> {
  try {
    const viewer = await requirePermission("video_intelligence:run");
    if (ids.length === 0) return { ok: false, message: "Geen video's geselecteerd." };
    const rows = await db
      .select({ id: videoAnalyses.id, clientId: videoAnalyses.clientId })
      .from(videoAnalyses)
      .where(inArray(videoAnalyses.id, ids.slice(0, 100)));

    let count = 0;
    for (const r of rows) {
      if (!hasClientAccess(viewer, r.clientId)) continue; // stil overslaan buiten scope
      await db.delete(videoAnalysisSteps).where(eq(videoAnalysisSteps.analysisId, r.id));
      await db.insert(videoAnalysisSteps).values(
        (["download", "probe", "shots", "editing", "ocr", "transcribe", "vision", "insights"] as const).map((step) => ({ analysisId: r.id, step })),
      );
      await db.update(videoAnalyses).set({ status: "queued", error: null, updatedAt: new Date() }).where(eq(videoAnalyses.id, r.id));
      void runPipeline(r.id).catch(() => {});
      count++;
    }
    revalidatePath("/video-intelligence");
    return { ok: true, data: { count } };
  } catch (e) {
    return fail(e);
  }
}

/** Analyse verwijderen (soft delete). */
export async function deleteAnalysis(id: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("video_intelligence:run");
    const [a] = await db.select({ clientId: videoAnalyses.clientId }).from(videoAnalyses).where(eq(videoAnalyses.id, id)).limit(1);
    if (!a) return { ok: false, message: "Analyse niet gevonden." };
    assertClientAccess(viewer, a.clientId);
    await db.update(videoAnalyses).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(videoAnalyses.id, id));
    await auditLog({ viewer, action: "video_intelligence.delete", entityType: "video_analysis", entityId: id, clientId: a.clientId });
    revalidatePath("/video-intelligence");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Handmatige sectie-indeling (hook/middenstuk/CTA) — overschrijft de heuristiek. */
export async function setSections(input: { id: string; hookEndMs: number | null; ctaStartMs: number | null }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("video_intelligence:run");
    const [a] = await db.select({ clientId: videoAnalyses.clientId }).from(videoAnalyses).where(eq(videoAnalyses.id, input.id)).limit(1);
    if (!a) return { ok: false, message: "Analyse niet gevonden." };
    assertClientAccess(viewer, a.clientId);
    const cleared = input.hookEndMs == null && input.ctaStartMs == null;
    await db.update(videoAnalyses).set({
      manualHookEndMs: input.hookEndMs,
      manualCtaStartMs: input.ctaStartMs,
      sectionsCorrectedById: cleared ? null : viewer.id,
      updatedAt: new Date(),
    }).where(eq(videoAnalyses.id, input.id));
    revalidatePath(`/video-intelligence/${input.id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Menselijke correctie van de hookclassificatie (blijft bewaard — spec 22). */
export async function correctHook(input: { id: string; hookText?: string; types?: string[] }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("video_intelligence:run");
    const [a] = await db.select({ clientId: videoAnalyses.clientId }).from(videoAnalyses).where(eq(videoAnalyses.id, input.id)).limit(1);
    if (!a) return { ok: false, message: "Analyse niet gevonden." };
    assertClientAccess(viewer, a.clientId);
    await db.insert(videoHooks).values({
      analysisId: input.id,
      hookText: input.hookText ?? null,
      types: input.types ?? [],
      correctedById: viewer.id,
      correctedAt: new Date(),
    }).onConflictDoUpdate({
      target: videoHooks.analysisId,
      set: {
        ...(input.hookText !== undefined ? { hookText: input.hookText } : {}),
        ...(input.types !== undefined ? { types: input.types } : {}),
        correctedById: viewer.id,
        correctedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    revalidatePath(`/video-intelligence/${input.id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
