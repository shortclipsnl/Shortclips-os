import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses, videoHooks } from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import { getIntelligenceOverview } from "./intelligence";

/**
 * Fase E — "Inzichten uit eerdere video's" bij een script.
 * Levert uitsluitend meetbare signalen uit reeds geanalyseerde video's van de
 * klant (hooktekst/-types, tijd tot eerste woord, spreektempo) plus een
 * doorklik naar de volledige Video Intelligence-analyse. Trekt bewust géén
 * causaal verband: dit is input voor de scriptschrijver, geen garantie.
 */

export type ScriptVideoInsight = {
  analysisId: string;
  title: string | null;
  platform: string | null;
  status: string;
  hookText: string | null;
  hookTypes: string[];
  timeToFirstWordMs: number | null;
};

export type ScriptVideoInsights = {
  total: number;
  dominantHooks: Array<{ key: string; n: number }>;
  avgWpm: number | null;
  avgWords3s: number | null;
  speechSample: number;
  videos: ScriptVideoInsight[];
};

const USABLE = ["complete", "partial", "needs_ai"] as const;

export async function getScriptVideoInsights(viewer: Viewer, clientId: string, clientSlug: string): Promise<ScriptVideoInsights> {
  assertClientAccess(viewer, clientId);
  const overview = await getIntelligenceOverview(viewer, clientSlug);

  const rows = await db
    .select({
      analysisId: videoAnalyses.id,
      title: videoAnalyses.title,
      platform: videoAnalyses.platform,
      status: videoAnalyses.status,
      hookText: videoHooks.hookText,
      types: videoHooks.types,
      timeToFirstWordMs: videoHooks.timeToFirstWordMs,
    })
    .from(videoAnalyses)
    .leftJoin(videoHooks, eq(videoHooks.analysisId, videoAnalyses.id))
    .where(and(isNull(videoAnalyses.deletedAt), eq(videoAnalyses.clientId, clientId), inArray(videoAnalyses.status, [...USABLE])))
    .orderBy(desc(videoAnalyses.createdAt))
    .limit(5);

  return {
    total: overview.total,
    dominantHooks: overview.hooks.slice(0, 4),
    avgWpm: overview.speech?.avgWpm ?? null,
    avgWords3s: overview.speech?.avgWords3s ?? null,
    speechSample: overview.samples.speech,
    videos: rows.map((r) => ({
      analysisId: r.analysisId,
      title: r.title,
      platform: r.platform ?? null,
      status: r.status,
      hookText: r.hookText,
      hookTypes: ((r.types as string[]) ?? []).slice(0, 3),
      timeToFirstWordMs: r.timeToFirstWordMs,
    })),
  };
}
