import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/server/auth/context";
import { getAnalysis } from "@/server/video-intelligence/queries";
import { getVideoBenchmarks, BENCHMARK_MIN_SAMPLE } from "@/server/video-intelligence/intelligence";
import { Avatar, Badge } from "@/components/ui";
import { VI_STATUS } from "../labels";
import { AnalysisView } from "./analysis-view";

export const metadata: Metadata = { title: "Video-analyse" };
export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("video_intelligence:read");
  const detail = await getAnalysis(viewer, id);
  if (!detail) notFound();
  const benchmarks = await getVideoBenchmarks(viewer, id);

  const a = detail.analysis;
  const insightOut = (detail.insight?.output ?? null) as
    | { watWerkt?: string[]; watMinder?: string[]; verbeteringen?: string[]; onzekerheden?: string[] }
    | null;

  const data = {
    id: a.id,
    title: a.title,
    status: a.status,
    platform: a.platform,
    sourceType: a.sourceType,
    sourceUrl: a.sourceUrl,
    caption: a.caption,
    durationMs: a.durationMs ?? 0,
    width: a.width,
    height: a.height,
    aspectRatio: a.aspectRatio,
    error: a.error,
    hasMedia: Boolean(a.mediaPath),
    hasThumb: Boolean(a.thumbnailData),
    clientName: detail.client?.name ?? "Onbekend",
    steps: detail.steps,
    shots: detail.shots.map((s) => ({
      idx: s.idx, startMs: s.startMs, endMs: s.endMs,
      shotType: s.shotType, description: s.description, transition: s.transition,
      textOnScreen: s.textOnScreen, motion: s.motion, hasThumb: Boolean(s.hasThumb),
    })),
    transcript: detail.transcript
      ? {
          fullText: detail.transcript.fullText,
          wpm: detail.transcript.wpm,
          firstWordMs: detail.transcript.firstWordMs,
          words3s: detail.transcript.words3s,
          words5s: detail.transcript.words5s,
          words10s: detail.transcript.words10s,
          words: (detail.transcript.words as Array<{ w: string; start: number; end: number }>) ?? [],
        }
      : null,
    editing: detail.editing
      ? {
          totalShots: detail.editing.totalShots, avgShotMs: detail.editing.avgShotMs,
          minShotMs: detail.editing.minShotMs, maxShotMs: detail.editing.maxShotMs,
          cutsPer10s: detail.editing.cutsPer10s, tempoHookMs: detail.editing.tempoHookMs,
          tempoMiddleMs: detail.editing.tempoMiddleMs, tempoEndMs: detail.editing.tempoEndMs,
        }
      : null,
    hook: detail.hook
      ? {
          startMs: detail.hook.startMs, endMs: detail.hook.endMs, hookText: detail.hook.hookText,
          types: (detail.hook.types as string[]) ?? [], form: (detail.hook.form as string[]) ?? [],
          elements: (detail.hook.elements as string[]) ?? [], firstWord: detail.hook.firstWord,
          timeToFirstWordMs: detail.hook.timeToFirstWordMs, shotCount: detail.hook.shotCount,
          correctedAt: detail.hook.correctedAt ? detail.hook.correctedAt.toISOString() : null,
        }
      : null,
    structure: (detail.structure?.segments as Array<{ part: string; startMs: number; endMs: number; summary: string }>) ?? null,
    overlays: (a.overlays as Array<{ appearMs: number; text: string; shot?: number }>) ?? [],
    manualHookEndMs: a.manualHookEndMs ?? null,
    manualCtaStartMs: a.manualCtaStartMs ?? null,
    sectionsCorrected: Boolean(a.sectionsCorrectedById),
    performance: detail.performance ?? null,
    insight: insightOut,
    benchmarks: benchmarks ?? [],
    benchMinSample: BENCHMARK_MIN_SAMPLE,
  };

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/video-intelligence" className="flex size-8 items-center justify-center rounded-full border border-[var(--color-line)] hover:bg-[var(--color-surface-2)]">
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{a.title || "Naamloze video"}</h1>
            <span className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Avatar name={data.clientName} size={18} /> {data.clientName}
            </span>
          </div>
        </div>
        <Badge tone={VI_STATUS[a.status]?.tone ?? "neutral"}>{VI_STATUS[a.status]?.label ?? a.status}</Badge>
      </div>

      <AnalysisView data={data} canRun={viewer.permissions.has("video_intelligence:run")} />
    </div>
  );
}
