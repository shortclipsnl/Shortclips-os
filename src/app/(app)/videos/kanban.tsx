import Link from "next/link";
import { Avatar, Badge } from "@/components/ui";
import { daysSince, relativeDays } from "@/lib/format";
import { VIDEO_STAGES, VIDEO_STATUS, stageOverdue } from "@/lib/statuses";
import type { VideoRow } from "@/server/videos";
import { cn } from "@/lib/cn";

/**
 * Kanban over de volledige pipeline. Bewust alleen leesbaar-en-doorklikken:
 * statussen wijzig je op de videopagina, waar de gevolgen (revisietellers,
 * goedkeuringen, automatiseringen) zichtbaar zijn.
 */
export function Kanban({ rows }: { rows: VideoRow[] }) {
  const stages = VIDEO_STAGES.filter((s) => s !== "analysis_available");

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex min-w-max gap-3">
        {stages.map((stage) => {
          const items = rows.filter((r) => r.status === stage);
          const meta = VIDEO_STATUS[stage];
          return (
            <section key={stage} className="flex w-64 shrink-0 flex-col">
              <header className="mb-2 flex items-center justify-between gap-2 px-1">
                <h2 className="text-sm font-semibold">{meta.short}</h2>
                <Badge tone={meta.tone}>{items.length}</Badge>
              </header>
              <div className="flex-1 space-y-2 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] p-2">
                {items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-[var(--color-ink-faint)]">
                    leeg
                  </p>
                ) : (
                  items.slice(0, 40).map((v) => {
                    const days = daysSince(v.statusChangedAt);
                    const late = stageOverdue(stage, days);
                    return (
                      <Link
                        key={v.id}
                        href={`/videos/${v.id}`}
                        className={cn(
                          "sc-card block p-3 transition-shadow hover:shadow-[var(--shadow-raised)]",
                          late && "border-l-[3px] border-l-[var(--color-warn)]",
                        )}
                      >
                        <p className="line-clamp-2 text-sm leading-snug font-medium">
                          {v.title}
                        </p>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Avatar name={v.clientName} color={v.clientColor} size={18} />
                          <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-ink-muted)]">
                            {v.clientName}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-2xs text-[var(--color-ink-faint)]">
                          <span className={late ? "font-semibold text-[var(--color-warn)]" : undefined}>
                            {days}d in stap
                          </span>
                          {v.dueOn ? <span>{relativeDays(v.dueOn)}</span> : null}
                        </div>
                      </Link>
                    );
                  })
                )}
                {items.length > 40 ? (
                  <p className="px-2 py-2 text-center text-2xs text-[var(--color-ink-faint)]">
                    +{items.length - 40} meer
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
