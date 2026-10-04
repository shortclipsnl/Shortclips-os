import Link from "next/link";
import { VIDEO_STAGES, VIDEO_STATUS, type VideoStage } from "@/lib/statuses";
import { cn } from "@/lib/cn";

const TONE_BG: Record<string, string> = {
  neutral: "bg-[var(--color-neutral-soft)]",
  info: "bg-[var(--color-info-soft)]",
  good: "bg-[var(--color-good-soft)]",
  warn: "bg-[var(--color-warn-soft)]",
  bad: "bg-[var(--color-bad-soft)]",
  lime: "bg-[var(--color-lime-soft)]",
  ink: "bg-[var(--color-neutral-soft)]",
};

/**
 * Compacte weergave van de hele pipeline: één kolom per stap, met het aantal
 * video's en hoe lang de oudste daar al staat.
 */
export function PipelineStrip({
  buckets,
  ages,
}: {
  buckets: Array<{ status: string; total: number }>;
  ages: Record<string, number>;
}) {
  const byStatus = new Map(buckets.map((b) => [b.status, b.total]));
  const max = Math.max(1, ...buckets.map((b) => b.total));

  return (
    <div className="overflow-x-auto px-5 pt-4 pb-5">
      <div className="flex min-w-[860px] items-end gap-1.5">
        {VIDEO_STAGES.filter((s) => s !== "analysis_available").map((stage) => {
          const total = byStatus.get(stage) ?? 0;
          const meta = VIDEO_STATUS[stage as VideoStage];
          const age = ages[stage];
          const height = 8 + Math.round((total / max) * 56);
          return (
            <Link
              key={stage}
              href={`/videos?status=${stage}`}
              className="group flex flex-1 flex-col items-center gap-1.5"
              title={`${meta.label}: ${total} video's`}
            >
              <span className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">
                {total}
              </span>
              <span
                className={cn(
                  "w-full rounded-t-[3px] transition-opacity group-hover:opacity-80",
                  TONE_BG[meta.tone] ?? "bg-[var(--color-neutral-soft)]",
                )}
                style={{ height }}
              />
              <span className="w-full border-t-2 border-[var(--color-line-strong)] pt-1.5 text-center text-2xs leading-tight text-[var(--color-ink-muted)]">
                {meta.short}
              </span>
              {age !== undefined && total > 0 ? (
                <span className="text-2xs text-[var(--color-ink-faint)]">
                  oudste {age}d
                </span>
              ) : (
                <span className="text-2xs text-transparent">–</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
