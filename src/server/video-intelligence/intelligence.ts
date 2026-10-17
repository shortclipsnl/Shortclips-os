import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses, videoEditingMetrics, videoTranscripts, videoHooks, clients } from "@/db/schema";
import { scopeToClients, assertClientAccess, type Viewer } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { mean, median } from "./metrics";
import { tools } from "./tools";

/** Minimum aantal vergelijkbare video's voordat een benchmark betrouwbaar is. */
export const BENCHMARK_MIN_SAMPLE = 3;

/** Beschikbaarheid van de externe tools/sleutels — voor het setup-paneel. */
export async function getToolStatus() {
  const [ffmpeg, ffprobe, ytdlp, whisper, ocr] = await Promise.all([
    tools.ffmpeg(), tools.ffprobe(), tools.ytdlp(), tools.whisper(), tools.ocr(),
  ]);
  return { ffmpeg, ffprobe, ytdlp, whisper, ocr, anthropic: aiConfigured() };
}

const avg = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * Aggregaten over alle (gescoopte) analyses — het begin van de "Shortclips
 * Intelligence". Eerlijk over steekproefgrootte: elk gemiddelde komt met het
 * aantal video's waarop het is gebaseerd. Leeg = nette nullen.
 */
export async function getIntelligenceOverview(viewer: Viewer, clientSlug?: string) {
  const scope = scopeToClients(viewer, videoAnalyses.clientId);
  let clientId: string | undefined;
  if (clientSlug) {
    const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, clientSlug)).limit(1);
    clientId = c?.id;
  }
  const analyses = await db
    .select({ id: videoAnalyses.id, status: videoAnalyses.status, platform: videoAnalyses.platform, durationMs: videoAnalyses.durationMs })
    .from(videoAnalyses)
    .where(and(isNull(videoAnalyses.deletedAt), scope ?? undefined, clientId ? eq(videoAnalyses.clientId, clientId) : undefined));

  const ids = analyses.map((a) => a.id);
  const byStatus = countBy(analyses.map((a) => a.status));
  const byPlatform = countBy(analyses.map((a) => a.platform ?? "onbekend"));

  if (ids.length === 0) {
    return { total: 0, byStatus, byPlatform: [] as Array<{ key: string; n: number }>, editing: null, speech: null, hooks: [] as Array<{ key: string; n: number }>, samples: { editing: 0, speech: 0, hooks: 0 } };
  }

  const [editRows, transRows, hookRows, durations] = await Promise.all([
    db.select().from(videoEditingMetrics).where(inArray(videoEditingMetrics.analysisId, ids)),
    db.select().from(videoTranscripts).where(inArray(videoTranscripts.analysisId, ids)),
    db.select().from(videoHooks).where(inArray(videoHooks.analysisId, ids)),
    Promise.resolve(analyses.filter((a) => a.durationMs).map((a) => a.durationMs!)),
  ]);

  const editing = editRows.length
    ? {
        avgShots: avg(editRows.map((r) => r.totalShots ?? 0)),
        avgShotMs: avg(editRows.filter((r) => r.avgShotMs != null).map((r) => r.avgShotMs!)),
        avgCutsPer10s: avg(editRows.filter((r) => r.cutsPer10s != null).map((r) => r.cutsPer10s!)),
        avgDurationMs: avg(durations),
      }
    : null;

  const speech = transRows.length
    ? {
        avgWpm: avg(transRows.filter((r) => r.wpm != null).map((r) => r.wpm!)),
        avgFirstWordMs: avg(transRows.filter((r) => r.firstWordMs != null).map((r) => r.firstWordMs!)),
        avgWords3s: avg(transRows.filter((r) => r.words3s != null).map((r) => r.words3s!)),
      }
    : null;

  // Hooktype-verdeling (elke video mag meerdere types hebben).
  const hookTypeCounts = new Map<string, number>();
  for (const h of hookRows) {
    for (const t of (h.types as string[]) ?? []) hookTypeCounts.set(t, (hookTypeCounts.get(t) ?? 0) + 1);
  }
  const hooks = [...hookTypeCounts.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);

  return {
    total: analyses.length,
    byStatus,
    byPlatform,
    editing,
    speech,
    hooks,
    samples: { editing: editRows.length, speech: transRows.length, hooks: hookRows.length },
  };
}

function countBy(values: string[]): Array<{ key: string; n: number }> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

export type BenchMetric = {
  key: string;
  label: string;
  unit: "s" | "count" | "n";
  value: number | null;
  client: { mean: number | null; median: number | null; n: number };
  all: { mean: number | null; median: number | null; n: number };
};

/**
 * Benchmark van één video tegen vergelijkbare video's: dezelfde klant én alle
 * (gescoopte) video's. Alleen meetbare cijfers (geen AI nodig). Eerlijk over
 * steekproefgrootte: elk cohort geeft n mee, en de UI waarschuwt bij n < 3.
 */
export async function getVideoBenchmarks(viewer: Viewer, analysisId: string): Promise<BenchMetric[] | null> {
  const [target] = await db.select().from(videoAnalyses).where(eq(videoAnalyses.id, analysisId)).limit(1);
  if (!target) return null;
  assertClientAccess(viewer, target.clientId);

  const scope = scopeToClients(viewer, videoAnalyses.clientId);
  const cohort = await db
    .select({ id: videoAnalyses.id, clientId: videoAnalyses.clientId, durationMs: videoAnalyses.durationMs })
    .from(videoAnalyses)
    .where(and(isNull(videoAnalyses.deletedAt), scope ?? undefined));

  const otherIds = cohort.map((c) => c.id).filter((id) => id !== analysisId);
  const [edit, trans, tEditRows, tTransRows] = await Promise.all([
    otherIds.length ? db.select().from(videoEditingMetrics).where(inArray(videoEditingMetrics.analysisId, otherIds)) : Promise.resolve([]),
    otherIds.length ? db.select().from(videoTranscripts).where(inArray(videoTranscripts.analysisId, otherIds)) : Promise.resolve([]),
    db.select().from(videoEditingMetrics).where(eq(videoEditingMetrics.analysisId, analysisId)).limit(1),
    db.select().from(videoTranscripts).where(eq(videoTranscripts.analysisId, analysisId)).limit(1),
  ]);
  const editBy = new Map(edit.map((e) => [e.analysisId, e]));
  const transBy = new Map(trans.map((t) => [t.analysisId, t]));
  const durBy = new Map(cohort.map((c) => [c.id, c.durationMs]));
  const tEdit = tEditRows[0];
  const tTrans = tTransRows[0];

  const clientIds = cohort.filter((c) => c.clientId === target.clientId && c.id !== analysisId).map((c) => c.id);
  const collect = (ids: string[], f: (id: string) => number | null | undefined) =>
    ids.map(f).filter((x): x is number => typeof x === "number");

  const metric = (
    key: string, label: string, unit: BenchMetric["unit"],
    value: number | null | undefined, f: (id: string) => number | null | undefined,
  ): BenchMetric => {
    const cv = collect(clientIds, f);
    const av = collect(otherIds, f);
    return {
      key, label, unit, value: value ?? null,
      client: { mean: mean(cv), median: median(cv), n: cv.length },
      all: { mean: mean(av), median: median(av), n: av.length },
    };
  };

  return [
    metric("duration", "Duur", "s", target.durationMs, (id) => durBy.get(id)),
    metric("totalShots", "Aantal shots", "count", tEdit?.totalShots, (id) => editBy.get(id)?.totalShots),
    metric("avgShotMs", "Gem. shotlengte", "s", tEdit?.avgShotMs, (id) => editBy.get(id)?.avgShotMs),
    metric("cutsPer10s", "Cuts per 10s", "count", tEdit?.cutsPer10s, (id) => editBy.get(id)?.cutsPer10s),
    metric("wpm", "Woorden/min", "n", tTrans?.wpm, (id) => transBy.get(id)?.wpm),
    metric("words3s", "Woorden in 3s", "n", tTrans?.words3s, (id) => transBy.get(id)?.words3s),
  ];
}
