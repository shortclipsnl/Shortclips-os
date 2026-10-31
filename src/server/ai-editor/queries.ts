import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { adEditFeedback, adEditProjects, adEditSources, adStyleAssets, adStyleProfiles, adStyleReferences, aiEditorJobs, users } from "@/db/schema";
import { STYLE_PROFILE_NAME, defaultStyleConfig, normalizeStyleConfig } from "./style-profile";

/** Zorgt dat er een actief profiel is (startversie = gemeten Shortclips Ads Style). */
export async function getOrCreateActiveStyle(createdById: string | null) {
  const [row] = await db.select().from(adStyleProfiles).where(eq(adStyleProfiles.isActive, true)).orderBy(desc(adStyleProfiles.version)).limit(1);
  if (row) return { ...row, config: normalizeStyleConfig(row.config) };
  const [created] = await db.insert(adStyleProfiles).values({
    name: STYLE_PROFILE_NAME,
    version: 1,
    isActive: true,
    config: defaultStyleConfig(),
    note: "Startversie, gemeten op de referentie-advertenties van oktober 2026.",
    createdById,
  }).returning();
  return { ...created!, config: normalizeStyleConfig(created!.config) };
}

export async function listStyleVersions() {
  return db.select({ id: adStyleProfiles.id, version: adStyleProfiles.version, isActive: adStyleProfiles.isActive, note: adStyleProfiles.note, createdAt: adStyleProfiles.createdAt, author: users.fullName })
    .from(adStyleProfiles).leftJoin(users, eq(users.id, adStyleProfiles.createdById)).orderBy(desc(adStyleProfiles.version));
}

export async function listProjects() {
  return db.select({
    id: adEditProjects.id, title: adEditProjects.title, status: adEditProjects.status, phase: adEditProjects.phase, progress: adEditProjects.progress,
    planVersion: adEditProjects.planVersion, updatedAt: adEditProjects.updatedAt, createdAt: adEditProjects.createdAt, author: users.fullName, costs: adEditProjects.costs,
  }).from(adEditProjects).leftJoin(users, eq(users.id, adEditProjects.createdById)).where(isNull(adEditProjects.deletedAt)).orderBy(desc(adEditProjects.updatedAt));
}

export async function getProject(id: string) {
  const [p] = await db.select().from(adEditProjects).where(and(eq(adEditProjects.id, id), isNull(adEditProjects.deletedAt))).limit(1);
  if (!p) return null;
  const [sources, feedback, jobs] = await Promise.all([
    db.select({ id: adEditSources.id, filename: adEditSources.filename, origin: adEditSources.origin, status: adEditSources.status, sizeBytes: adEditSources.sizeBytes, durationMs: adEditSources.durationMs, analysis: adEditSources.analysis, probe: adEditSources.probe })
      .from(adEditSources).where(eq(adEditSources.projectId, id)).orderBy(asc(adEditSources.createdAt)),
    db.select().from(adEditFeedback).where(eq(adEditFeedback.projectId, id)).orderBy(desc(adEditFeedback.createdAt)),
    db.select({ id: aiEditorJobs.id, kind: aiEditorJobs.kind, status: aiEditorJobs.status, createdAt: aiEditorJobs.createdAt, error: aiEditorJobs.error })
      .from(aiEditorJobs).where(eq(aiEditorJobs.projectId, id)).orderBy(desc(aiEditorJobs.createdAt)).limit(10),
  ]);
  return { project: p, sources, feedback, jobs };
}

export async function listReferences() {
  return db.select().from(adStyleReferences).where(isNull(adStyleReferences.deletedAt)).orderBy(desc(adStyleReferences.createdAt));
}

export async function listAssets() {
  return db.select().from(adStyleAssets).where(isNull(adStyleAssets.deletedAt)).orderBy(desc(adStyleAssets.createdAt));
}

/** Staan er jobs in de wachtrij zonder dat een worker ze oppakt? (voor een eerlijke melding) */
export async function pendingJobs(projectIds?: string[]) {
  const base = db.select({ id: aiEditorJobs.id, createdAt: aiEditorJobs.createdAt, projectId: aiEditorJobs.projectId }).from(aiEditorJobs);
  return projectIds?.length
    ? base.where(and(eq(aiEditorJobs.status, "queued"), inArray(aiEditorJobs.projectId, projectIds)))
    : base.where(eq(aiEditorJobs.status, "queued"));
}

/** Aantal jobs dat al meer dan twee minuten in de wachtrij staat (geen worker actief?). */
export async function staleQueuedCount(): Promise<number> {
  const rows = await pendingJobs();
  const now = Date.now();
  return rows.filter((j) => now - new Date(j.createdAt).getTime() > 120_000).length;
}
