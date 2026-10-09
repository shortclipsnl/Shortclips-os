import Link from "next/link";
import { VIDEO_STAGES, VIDEO_STATUS, type VideoStage } from "@/lib/statuses";

/**
 * Solide, contrastrijke kleur per fase-tone. Bewust geen lichte pastels: het
 * team moet in één oogopslag zien waar het werk zit, ook op een helder scherm.
 */
const TONE_SOLID: Record<string, string> = {
  neutral: "#6b6b85",
  info: "var(--color-brand-600)",
  good: "var(--color-good)",
  warn: "var(--color-warn)",
  bad: "var(--color-bad)",
  lime: "#6f8c00",
  ink: "var(--color-indigo-ink)",
};

/**
 * De hele pipeline als staafdiagram: één kolom per fase met het aantal video's
 * en hoe lang de oudste daar al staat. Contrastrijke staven in de huisstijl.
 */
export function PipelineStrip({
  buckets,
  ages,
}: {
  buckets: Array<{ status: string; total: number }>;
  ages: Record<string, number>;
}) {
  const byStatus = new Map(buckets.map((b) => [b.status, b.total]));
  const stages = VIDEO_STAGES.filter((s) => s !== "analysis_available");
  const max = Math.max(1, ...stages.map((s) => byStatus.get(s) ?? 0));

  return (
    <div className="overflow-x-auto px-5 pt-5 pb-4">
      <div className="flex min-w-[900px] items-end gap-2">
        {stages.map((stage) => {
          const total = byStatus.get(stage) ?? 0;
          const meta = VIDEO_STATUS[stage as VideoStage];
          const color = TONE_SOLID[meta.tone] ?? TONE_SOLID.neutral;
          const age = ages[stage];
          const height = total === 0 ? 4 : 16 + Math.round((total / max) * 92);
          return (
            <Link
              key={stage}
              href={`/videos?status=${stage}`}
              className="group flex flex-1 flex-col items-center gap-1.5"
              title={`${meta.label}: ${total} video's${age !== undefined && total > 0 ? ` · oudste ${age} dagen` : ""}`}
            >
              <span
                className={`text-base font-bold tabular-nums ${total > 0 ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]"}`}
              >
                {total}
              </span>
              <span
                className="flex w-full items-start justify-center rounded-t-[4px] transition-opacity group-hover:opacity-85"
                style={{ height, background: total === 0 ? "var(--color-line)" : color }}
              />
              <span className="flex w-full flex-col items-center gap-1 border-t-2 border-[var(--color-line-strong)] pt-1.5">
                <span className="size-2 rounded-full" style={{ background: color }} />
                <span className="text-center text-2xs font-medium leading-tight text-[var(--color-ink-muted)]">
                  {meta.short}
                </span>
              </span>
              {age !== undefined && total > 0 ? (
                <span className="text-2xs tabular-nums text-[var(--color-ink-faint)]">{age}d</span>
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
