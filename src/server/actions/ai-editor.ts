"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db/client";
import { adEditFeedback, adEditProjects, adEditSources, adStyleAssets, adStyleProfiles, adStyleReferences, aiEditorJobs } from "@/db/schema";
import { ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { drive, DriveService } from "@/server/integrations/drive";
import { kickInline } from "@/server/ai-editor/inline";
import { enqueue } from "@/server/ai-editor/queue";
import { getOrCreateActiveStyle } from "@/server/ai-editor/queries";
import { normalizeStyleConfig, STYLE_PROFILE_NAME, type StyleConfig } from "@/server/ai-editor/style-profile";
import type { StoredPlan } from "@/server/ai-editor/pipeline";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; message: string };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof ForbiddenError) return { ok: false, message: e.message };
  if (e instanceof Error) return { ok: false, message: e.message };
  return { ok: false, message: String(e) };
}

function kick() {
  after(async () => { await kickInline(); });
}

/** Er mag per project maar één job tegelijk in de wachtrij of in verwerking staan. */
async function assertIdle(projectId: string) {
  const [busy] = await db.select({ id: aiEditorJobs.id }).from(aiEditorJobs)
    .where(and(eq(aiEditorJobs.projectId, projectId), isNull(aiEditorJobs.finishedAt))).limit(1);
  if (busy) throw new Error("Er loopt al een verwerking voor deze video. Wacht tot die klaar is.");
}

export async function createProject(input: { title: string; script?: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const viewer = await requirePermission("ai_editor:run");
    const title = input.title.trim();
    if (!title) return { ok: false, message: "Geef de video een titel." };
    const style = await getOrCreateActiveStyle(viewer.id);
    const [row] = await db.insert(adEditProjects).values({ title: title.slice(0, 240), script: input.script?.trim() || null, styleProfileId: style.id, createdById: viewer.id }).returning({ id: adEditProjects.id });
    await auditLog({ viewer, action: "ai_editor.project_create", entityType: "ad_edit_project", entityId: row!.id });
    revalidatePath("/ai-editor");
    return { ok: true, data: { id: row!.id } };
  } catch (e) { return fail(e); }
}

export async function updateProject(input: { id: string; title?: string; script?: string; styleProfileId?: string }): Promise<ActionResult> {
  try {
    await requirePermission("ai_editor:run");
    const set: Partial<typeof adEditProjects.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) set.title = input.title.trim().slice(0, 240) || "Zonder titel";
    if (input.script !== undefined) set.script = input.script.trim() || null;
    if (input.styleProfileId) set.styleProfileId = input.styleProfileId;
    await db.update(adEditProjects).set(set).where(eq(adEditProjects.id, input.id));
    revalidatePath(`/ai-editor/${input.id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteProject(id: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai_editor:run");
    await db.update(adEditProjects).set({ deletedAt: new Date() }).where(eq(adEditProjects.id, id));
    await auditLog({ viewer, action: "ai_editor.project_delete", entityType: "ad_edit_project", entityId: id });
    revalidatePath("/ai-editor");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Ruwe beelden uit Google Drive toevoegen (map- of bestandslink). Geen uploadlimiet. */
export async function addDriveSources(input: { projectId: string; link: string }): Promise<ActionResult<{ added: number }>> {
  try {
    await requirePermission("ai_editor:run");
    if (!drive.isConfigured) return { ok: false, message: "Google Drive is nog niet gekoppeld (Koppelingen)." };
    const m = input.link.match(/(?:folders\/|file\/d\/|id=)([A-Za-z0-9_-]{10,})/) ?? input.link.trim().match(/^([A-Za-z0-9_-]{20,})$/);
    if (!m) return { ok: false, message: "Plak een Google Drive-link naar een map of een videobestand." };
    const id = m[1];
    const file = await drive.getFile(id);
    const files = DriveService.isFolder(file) ? (await drive.listFolder(id)).filter((f) => f.mimeType.startsWith("video/")) : file.mimeType.startsWith("video/") ? [file] : [];
    if (!files.length) return { ok: false, message: "Geen videobestanden gevonden op deze link." };
    files.sort((a, b) => a.name.localeCompare(b.name, "nl", { numeric: true }));
    await db.insert(adEditSources).values(files.map((f) => ({
      projectId: input.projectId, filename: f.name, origin: "drive", driveFileId: f.id, sizeBytes: f.size ? Number(f.size) : null, status: "ready",
    })));
    revalidatePath(`/ai-editor/${input.projectId}`);
    return { ok: true, data: { added: files.length } };
  } catch (e) { return fail(e); }
}

export async function removeSource(sourceId: string): Promise<ActionResult> {
  try {
    await requirePermission("ai_editor:run");
    const [s] = await db.select({ projectId: adEditSources.projectId }).from(adEditSources).where(eq(adEditSources.id, sourceId)).limit(1);
    if (!s) return { ok: false, message: "Bestand niet gevonden." };
    await db.delete(adEditSources).where(eq(adEditSources.id, sourceId));
    revalidatePath(`/ai-editor/${s.projectId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function setSourceRole(input: { sourceId: string; role: "speaker" | "broll" | "auto" }): Promise<ActionResult> {
  try {
    await requirePermission("ai_editor:run");
    const [s] = await db.select().from(adEditSources).where(eq(adEditSources.id, input.sourceId)).limit(1);
    if (!s) return { ok: false, message: "Bestand niet gevonden." };
    const a = (s.analysis ?? {}) as Record<string, unknown>;
    const override = input.role === "auto" ? null : input.role;
    await db.update(adEditSources).set({ analysis: { ...a, roleOverride: override, ...(override ? { role: override } : {}) }, updatedAt: new Date() }).where(eq(adEditSources.id, input.sourceId));
    revalidatePath(`/ai-editor/${s.projectId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function generate(projectId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai_editor:run");
    const sources = await db.select({ status: adEditSources.status }).from(adEditSources).where(eq(adEditSources.projectId, projectId));
    if (!sources.length) return { ok: false, message: "Voeg eerst de ruwe camerabestanden toe." };
    if (sources.some((s) => s.status === "uploading")) return { ok: false, message: "Er worden nog bestanden geüpload." };
    await assertIdle(projectId);
    await db.update(adEditProjects).set({ status: "queued", phase: "In de wachtrij", progress: 0, error: null, updatedAt: new Date() }).where(eq(adEditProjects.id, projectId));
    await enqueue("generate", { projectId });
    await auditLog({ viewer, action: "ai_editor.generate", entityType: "ad_edit_project", entityId: projectId });
    kick();
    revalidatePath(`/ai-editor/${projectId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function chooseTake(input: { projectId: string; sentenceIdx: number; takeId: string }): Promise<ActionResult> {
  try {
    await requirePermission("ai_editor:run");
    await assertIdle(input.projectId);
    await db.update(adEditProjects).set({ status: "queued", phase: "Take wisselen", progress: 0, updatedAt: new Date() }).where(eq(adEditProjects.id, input.projectId));
    await enqueue("revise", { projectId: input.projectId, payload: { takeChoice: { sentenceIdx: input.sentenceIdx, takeId: input.takeId } } });
    kick();
    revalidatePath(`/ai-editor/${input.projectId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function submitFeedback(input: { projectId: string; text: string }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai_editor:run");
    const text = input.text.trim();
    if (text.length < 3) return { ok: false, message: "Schrijf wat er anders moet." };
    await assertIdle(input.projectId);
    const [fb] = await db.insert(adEditFeedback).values({ projectId: input.projectId, text: text.slice(0, 2000), createdById: viewer.id }).returning({ id: adEditFeedback.id });
    await db.update(adEditProjects).set({ status: "queued", phase: "Feedback in de wachtrij", progress: 0, updatedAt: new Date() }).where(eq(adEditProjects.id, input.projectId));
    await enqueue("revise", { projectId: input.projectId, payload: { feedbackId: fb!.id } });
    kick();
    revalidatePath(`/ai-editor/${input.projectId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function exportFinal(input: { projectId: string; format: "9x16" | "4x5" | "1x1" }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai_editor:run");
    const [p] = await db.select({ plan: adEditProjects.plan, qc: adEditProjects.qc }).from(adEditProjects).where(eq(adEditProjects.id, input.projectId)).limit(1);
    const stored = p?.plan as StoredPlan | null;
    if (!stored) return { ok: false, message: "Er is nog geen montage." };
    if (stored.plan.takes.some((t) => t.needsUser)) return { ok: false, message: "Kies eerst de takes waarover getwijfeld wordt." };
    const qc = p?.qc as { passed?: boolean } | null;
    if (qc && qc.passed === false) return { ok: false, message: "De preview heeft nog technische fouten (zie Kwaliteitscontrole). Los die eerst op." };
    await assertIdle(input.projectId);
    await db.update(adEditProjects).set({ status: "queued", phase: "Export in de wachtrij", progress: 0, updatedAt: new Date() }).where(eq(adEditProjects.id, input.projectId));
    await enqueue("export", { projectId: input.projectId, payload: { format: input.format } });
    await auditLog({ viewer, action: "ai_editor.export", entityType: "ad_edit_project", entityId: input.projectId, changes: { format: input.format } });
    kick();
    revalidatePath(`/ai-editor/${input.projectId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** "Gebruik deze video als stijlreferentie": de definitieve export gaat naar Stijlbeheer. */
export async function markAsStyleReference(projectId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai_editor:style");
    const [p] = await db.select().from(adEditProjects).where(eq(adEditProjects.id, projectId)).limit(1);
    if (!p?.finalPath || !p.finalStore) return { ok: false, message: "Exporteer de video eerst definitief." };
    const [ref] = await db.insert(adStyleReferences).values({ title: p.title, mediaStore: p.finalStore, mediaPath: p.finalPath, fromProjectId: p.id, status: "queued", createdById: viewer.id }).returning({ id: adStyleReferences.id });
    await enqueue("analyze_reference", { referenceId: ref!.id });
    kick();
    revalidatePath("/ai-editor/stijl");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/* ------------------------------ Stijlbeheer ------------------------------ */

/** Nieuwe versie van het profiel (wordt meteen actief; de vorige blijft herstelbaar). */
export async function saveStyleVersion(input: { config: StyleConfig; note?: string }): Promise<ActionResult<{ version: number }>> {
  try {
    const viewer = await requirePermission("ai_editor:style");
    const config = normalizeStyleConfig(input.config);
    const [last] = await db.select({ version: adStyleProfiles.version }).from(adStyleProfiles).orderBy(desc(adStyleProfiles.version)).limit(1);
    const version = (last?.version ?? 0) + 1;
    await db.update(adStyleProfiles).set({ isActive: false, updatedAt: new Date() }).where(eq(adStyleProfiles.isActive, true));
    await db.insert(adStyleProfiles).values({ name: STYLE_PROFILE_NAME, version, isActive: true, config, note: input.note?.trim() || null, createdById: viewer.id });
    await auditLog({ viewer, action: "ai_editor.style_save", entityType: "ad_style_profile", changes: { version } });
    revalidatePath("/ai-editor/stijl");
    return { ok: true, data: { version } };
  } catch (e) { return fail(e); }
}

export async function restoreStyleVersion(id: string): Promise<ActionResult<{ version: number }>> {
  try {
    await requirePermission("ai_editor:style");
    const [row] = await db.select().from(adStyleProfiles).where(eq(adStyleProfiles.id, id)).limit(1);
    if (!row) return { ok: false, message: "Versie niet gevonden." };
    return saveStyleVersion({ config: normalizeStyleConfig(row.config), note: `Hersteld vanaf versie ${row.version}` });
  } catch (e) { return fail(e); }
}

/** Voorstel uit een referentie overnemen: alleen de aangevinkte waarden, als nieuwe versie. */
export async function acceptProposal(input: { referenceId: string; paths: string[] }): Promise<ActionResult<{ version: number }>> {
  try {
    await requirePermission("ai_editor:style");
    const [ref] = await db.select().from(adStyleReferences).where(eq(adStyleReferences.id, input.referenceId)).limit(1);
    const proposal = (ref?.proposal ?? []) as Array<{ path: string; proposed: number }>;
    const chosen = proposal.filter((p) => input.paths.includes(p.path));
    if (!chosen.length) return { ok: false, message: "Vink minimaal één waarde aan." };
    const style = await getOrCreateActiveStyle(null);
    const cfg = JSON.parse(JSON.stringify(style.config)) as Record<string, Record<string, unknown>>;
    for (const c of chosen) {
      const [group, key] = c.path.split(".");
      if (cfg[group] && key in cfg[group]) cfg[group][key] = c.proposed;
    }
    return saveStyleVersion({ config: cfg as unknown as StyleConfig, note: `Overgenomen uit referentie "${ref!.title}": ${chosen.map((c) => c.path).join(", ")}` });
  } catch (e) { return fail(e); }
}

export async function reanalyzeReference(id: string): Promise<ActionResult> {
  try {
    await requirePermission("ai_editor:style");
    await db.update(adStyleReferences).set({ status: "queued", updatedAt: new Date() }).where(eq(adStyleReferences.id, id));
    await enqueue("analyze_reference", { referenceId: id });
    kick();
    revalidatePath("/ai-editor/stijl");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteReference(id: string): Promise<ActionResult> {
  try {
    await requirePermission("ai_editor:style");
    await db.update(adStyleReferences).set({ deletedAt: new Date() }).where(eq(adStyleReferences.id, id));
    revalidatePath("/ai-editor/stijl");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function setAssetActive(input: { id: string; active: boolean }): Promise<ActionResult> {
  try {
    await requirePermission("ai_editor:style");
    await db.update(adStyleAssets).set({ isActive: input.active, updatedAt: new Date() }).where(eq(adStyleAssets.id, input.id));
    revalidatePath("/ai-editor/stijl");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteAsset(id: string): Promise<ActionResult> {
  try {
    await requirePermission("ai_editor:style");
    await db.update(adStyleAssets).set({ deletedAt: new Date() }).where(eq(adStyleAssets.id, id));
    revalidatePath("/ai-editor/stijl");
    return { ok: true };
  } catch (e) { return fail(e); }
}
