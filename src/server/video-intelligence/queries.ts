import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  videoAnalyses,
  videoAnalysisSteps,
  videoShots,
  videoEditingMetrics,
  videoTranscripts,
  videoHooks,
  videoStructure,
  aiOutputs,
  clients,
  socialMetrics,
  publications,
} from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";
import { PIPELINE_STEPS } from "./pipeline";

export type AnalysisFilters = { clientSlug?: string; platform?: string; status?: string };

/** Lijst met analyses, beperkt tot de klanten die de viewer mag zien + filters. */
export async function listAnalyses(viewer: Viewer, filters: AnalysisFilters = {}) {
  const scope = scopeToClients(viewer, videoAnalyses.clientId);
  const conds = [isNull(videoAnalyses.deletedAt), scope ?? undefined];
  if (filters.clientSlug) conds.push(eq(clients.slug, filters.clientSlug));
  if (filters.platform) conds.push(eq(videoAnalyses.platform, filters.platform as "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin"));
  if (filters.status) conds.push(eq(videoAnalyses.status, filters.status as "queued" | "downloading" | "processing" | "needs_ai" | "partial" | "complete" | "failed"));
  const rows = await db
    .select({
      id: videoAnalyses.id,
      title: videoAnalyses.title,
      platform: videoAnalyses.platform,
      status: videoAnalyses.status,
      sourceType: videoAnalyses.sourceType,
      durationMs: videoAnalyses.durationMs,
      thumbnailPath: videoAnalyses.thumbnailPath,
      createdAt: videoAnalyses.createdAt,
      clientName: clients.name,
      clientColor: clients.color,
      clientSlug: clients.slug,
    })
    .from(videoAnalyses)
    .innerJoin(clients, eq(clients.id, videoAnalyses.clientId))
    .where(and(...conds))
    .orderBy(desc(videoAnalyses.createdAt))
    .limit(200);
  return rows;
}

export type AnalysisDetail = Awaited<ReturnType<typeof getAnalysis>>;

/** Volledige analyse voor de detailpagina. Hard gescoped op klanttoegang. */
export async function getAnalysis(viewer: Viewer, id: string) {
  const [a] = await db
    .select()
    .from(videoAnalyses)
    .where(and(eq(videoAnalyses.id, id), isNull(videoAnalyses.deletedAt)))
    .limit(1);
  if (!a) return null;
  assertClientAccess(viewer, a.clientId);

  const [client] = await db
    .select({ name: clients.name, color: clients.color, slug: clients.slug })
    .from(clients)
    .where(eq(clients.id, a.clientId))
    .limit(1);

  const [steps, shots, transcriptRows, editingRows, hookRows, structureRows, insightRows] = await Promise.all([
    db.select().from(videoAnalysisSteps).where(eq(videoAnalysisSteps.analysisId, id)),
    db.select().from(videoShots).where(eq(videoShots.analysisId, id)).orderBy(videoShots.idx),
    db.select().from(videoTranscripts).where(eq(videoTranscripts.analysisId, id)).limit(1),
    db.select().from(videoEditingMetrics).where(eq(videoEditingMetrics.analysisId, id)).limit(1),
    db.select().from(videoHooks).where(eq(videoHooks.analysisId, id)).limit(1),
    db.select().from(videoStructure).where(eq(videoStructure.analysisId, id)).limit(1),
    db.select().from(aiOutputs).where(and(eq(aiOutputs.clientId, a.clientId), eq(aiOutputs.tool, "video_intelligence"))).orderBy(desc(aiOutputs.createdAt)).limit(1),
  ]);

  // Stappen in vaste pijplijnvolgorde, ontbrekende = pending.
  const byStep = new Map(steps.map((s) => [s.step, s]));
  const orderedSteps = PIPELINE_STEPS.map((step) => {
    const row = byStep.get(step);
    return { step, status: row?.status ?? "pending", detail: row?.detail ?? null };
  });

  // Prestatie-koppeling: echte platformcijfers als deze analyse aan een
  // publicatie (of deliverable) hangt. Anders null → "nog niet gekoppeld".
  const performance = await resolvePerformance(a.publicationId, a.deliverableId);

  return {
    analysis: a,
    client: client ?? null,
    steps: orderedSteps,
    shots,
    transcript: transcriptRows[0] ?? null,
    editing: editingRows[0] ?? null,
    hook: hookRows[0] ?? null,
    structure: structureRows[0] ?? null,
    performance,
    insight: insightRows[0] ?? null,
  };
}

/** Laatste bekende platformcijfers voor een gekoppelde publicatie/deliverable. */
async function resolvePerformance(publicationId: string | null, deliverableId: string | null) {
  let pubIds: string[] = [];
  if (publicationId) pubIds = [publicationId];
  else if (deliverableId) {
    const pubs = await db.select({ id: publications.id }).from(publications).where(eq(publications.deliverableId, deliverableId));
    pubIds = pubs.map((p) => p.id);
  }
  if (pubIds.length === 0) return null;

  // Nieuwste meting per publicatie, dan optellen.
  const rows = await db
    .select({ publicationId: socialMetrics.publicationId, measuredOn: socialMetrics.measuredOn, views: socialMetrics.views, reach: socialMetrics.reach, likes: socialMetrics.likes, comments: socialMetrics.comments, shares: socialMetrics.shares, saves: socialMetrics.saves, avgWatchSeconds: socialMetrics.avgWatchSeconds })
    .from(socialMetrics)
    .where(inArray(socialMetrics.publicationId, pubIds))
    .orderBy(desc(socialMetrics.measuredOn));
  if (rows.length === 0) return null;
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.publicationId)) latest.set(r.publicationId, r);
  const vals = [...latest.values()];
  const sum = (f: (r: (typeof rows)[number]) => number | null) => vals.reduce((a, r) => a + Number(f(r) ?? 0), 0);
  return {
    views: sum((r) => r.views),
    reach: sum((r) => r.reach),
    likes: sum((r) => r.likes),
    comments: sum((r) => r.comments),
    shares: sum((r) => r.shares),
    saves: sum((r) => r.saves),
    avgWatchSeconds: vals[0]?.avgWatchSeconds ? Number(vals[0].avgWatchSeconds) : null,
  };
}

/** Alleen de stapstatussen (voor lichte polling van voortgang). */
export async function getSteps(viewer: Viewer, id: string) {
  const [a] = await db.select({ clientId: videoAnalyses.clientId, status: videoAnalyses.status }).from(videoAnalyses).where(eq(videoAnalyses.id, id)).limit(1);
  if (!a) return null;
  assertClientAccess(viewer, a.clientId);
  const steps = await db.select({ step: videoAnalysisSteps.step, status: videoAnalysisSteps.status, detail: videoAnalysisSteps.detail }).from(videoAnalysisSteps).where(eq(videoAnalysisSteps.analysisId, id));
  const byStep = new Map(steps.map((s) => [s.step, s]));
  return {
    status: a.status,
    steps: PIPELINE_STEPS.map((step) => ({ step, status: byStep.get(step)?.status ?? "pending", detail: byStep.get(step)?.detail ?? null })),
  };
}

/** Klanten die de viewer mag kiezen bij "video toevoegen". */
export async function assignableClients(viewer: Viewer) {
  const scope = viewer.clientScope;
  const where = scope === null
    ? and(eq(clients.status, "active"), isNull(clients.deletedAt))
    : scope.length === 0
      ? and(eq(clients.id, "00000000-0000-0000-0000-000000000000"))
      : and(inArray(clients.id, scope), isNull(clients.deletedAt));
  return db.select({ id: clients.id, name: clients.name, slug: clients.slug, color: clients.color }).from(clients).where(where).orderBy(clients.name);
}
