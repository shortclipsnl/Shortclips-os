"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import { changeVideoStatus } from "@/server/actions/videos";
import { daysSince, relativeDays } from "@/lib/format";
import { VIDEO_STAGES, VIDEO_STATUS, stageOverdue } from "@/lib/statuses";
import type { VideoRow } from "@/server/videos";
import { cn } from "@/lib/cn";

/**
 * Kanban over de volledige pipeline. Sleep een kaart naar een andere kolom om
 * de status te wijzigen (Monday-stijl); klik op de titel om de video te openen.
 * De gevolgen (revisietellers, goedkeuringen, automatiseringen) lopen gewoon mee
 * via changeVideoStatus.
 */
export function Kanban({ rows, canEdit = false }: { rows: VideoRow[]; canEdit?: boolean }) {
  const stages = VIDEO_STAGES.filter((s) => s !== "analysis_available");
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function drop(stage: string) {
    const id = dragId;
    setOver(null);
    setDragId(null);
    if (!id) return;
    const current = rows.find((r) => r.id === id);
    if (!current || current.status === stage) return;
    setErr(null);
    start(async () => {
      const res = await changeVideoStatus(id, stage);
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Verplaatsen mislukt");
    });
  }

  return (
    <div className="overflow-x-auto pb-4">
      {canEdit ? (
        <p className="mb-2 px-1 text-xs text-[var(--color-ink-faint)]">
          Sleep een kaart naar een andere kolom om de status te wijzigen.{pending ? <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-brand-600)]"><Loader2 className="size-3 animate-spin" /> opslaan…</span> : null}
          {err ? <span className="ml-2 text-[var(--color-bad)]">{err}</span> : null}
        </p>
      ) : null}
      <div className="flex min-w-max gap-3">
        {stages.map((stage) => {
          const items = rows.filter((r) => r.status === stage);
          const meta = VIDEO_STATUS[stage];
          return (
            <section
              key={stage}
              className="flex w-64 shrink-0 flex-col"
              onDragOver={canEdit ? (e) => { e.preventDefault(); setOver(stage); } : undefined}
              onDragLeave={canEdit ? () => setOver((o) => (o === stage ? null : o)) : undefined}
              onDrop={canEdit ? () => drop(stage) : undefined}
            >
              <header className="mb-2 flex items-center justify-between gap-2 px-1">
                <h2 className="text-sm font-semibold">{meta.short}</h2>
                <Badge tone={meta.tone}>{items.length}</Badge>
              </header>
              <div className={cn(
                "flex-1 space-y-2 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] p-2 transition-colors",
                over === stage && canEdit && "ring-2 ring-[var(--color-brand-600)] ring-inset",
              )}>
                {items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-[var(--color-ink-faint)]">{over === stage && canEdit ? "Laat hier los" : "leeg"}</p>
                ) : (
                  items.slice(0, 40).map((v) => {
                    const days = daysSince(v.statusChangedAt);
                    const late = stageOverdue(stage, days);
                    return (
                      <div
                        key={v.id}
                        draggable={canEdit}
                        onDragStart={canEdit ? () => setDragId(v.id) : undefined}
                        onDragEnd={canEdit ? () => { setDragId(null); setOver(null); } : undefined}
                        className={cn(
                          "sc-card block p-3 transition-shadow hover:shadow-[var(--shadow-raised)]",
                          canEdit && "cursor-grab active:cursor-grabbing",
                          dragId === v.id && "opacity-50",
                          late && "border-l-[3px] border-l-[var(--color-warn)]",
                        )}
                      >
                        <Link href={`/videos/${v.id}`} className="line-clamp-2 text-sm leading-snug font-medium hover:underline">
                          {v.title}
                        </Link>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Avatar name={v.clientName} color={v.clientColor} size={18} />
                          <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-ink-muted)]">{v.clientName}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-2xs text-[var(--color-ink-faint)]">
                          <span className={late ? "font-semibold text-[var(--color-warn)]" : undefined}>{days}d in stap</span>
                          {v.dueOn ? <span>{relativeDays(v.dueOn)}</span> : null}
                        </div>
                      </div>
                    );
                  })
                )}
                {items.length > 40 ? (
                  <p className="px-2 py-2 text-center text-2xs text-[var(--color-ink-faint)]">+{items.length - 40} meer</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
