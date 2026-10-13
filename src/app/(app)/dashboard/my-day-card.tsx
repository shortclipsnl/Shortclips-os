import Link from "next/link";
import { Camera, CircleCheck, Clapperboard } from "lucide-react";
import { Avatar, Badge, Card } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { VIDEO_STATUS, type VideoStage } from "@/lib/statuses";
import type { getMyDay } from "@/server/my-day";

type Day = Awaited<ReturnType<typeof getMyDay>>;

const PRIO_TONE: Record<string, "bad" | "warn" | "neutral"> = { urgent: "bad", high: "warn", normal: "neutral", low: "neutral" };

/** "Mijn dag": wat de ingelogde persoon zelf te doen heeft. */
export function MyDayCard({ day, firstName }: { day: Day; firstName: string }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-bold tracking-tight">Mijn dag · {firstName}</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {/* Eigen opnames */}
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink-muted)]">
            <Camera className="size-3.5 text-[var(--color-brand-600)]" /> Mijn opnames
          </h3>
          {day.shoots.length === 0 ? (
            <p className="text-2xs text-[var(--color-ink-faint)]">Geen opnames gepland.</p>
          ) : (
            <ul className="space-y-1.5">
              {day.shoots.map((s) => (
                <li key={s.id}>
                  <Link href={`/productions/${s.id}`} className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 hover:bg-[var(--color-surface-sunken)]">
                    <Avatar name={s.clientName} color={s.clientColor} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.clientName}</span>
                      <span className="block truncate text-2xs text-[var(--color-ink-faint)]">
                        {formatDate(s.scheduledOn)}{s.startTime ? ` · ${s.startTime.slice(0, 5)}` : ""}{s.locationName ? ` · ${s.locationName}` : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Eigen taken */}
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink-muted)]">
            <CircleCheck className="size-3.5 text-[var(--color-brand-600)]" /> Mijn taken
          </h3>
          {day.tasks.length === 0 ? (
            <p className="text-2xs text-[var(--color-ink-faint)]">Geen open taken.</p>
          ) : (
            <ul className="space-y-1.5">
              {day.tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2 px-1.5 py-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{t.title}</span>
                    <span className="block truncate text-2xs text-[var(--color-ink-faint)]">
                      {t.clientName ? `${t.clientName} · ` : ""}{t.dueOn ? formatDate(t.dueOn) : "geen datum"}
                    </span>
                  </span>
                  {t.overdue ? <Badge tone="bad">te laat</Badge> : t.priority !== "normal" ? <Badge tone={PRIO_TONE[t.priority] ?? "neutral"}>{t.priority}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Eigen editwerk */}
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink-muted)]">
            <Clapperboard className="size-3.5 text-[var(--color-brand-600)]" /> Mijn editwerk
          </h3>
          {day.videos.length === 0 ? (
            <p className="text-2xs text-[var(--color-ink-faint)]">Geen video&apos;s in bewerking.</p>
          ) : (
            <ul className="space-y-1.5">
              {day.videos.map((v) => (
                <li key={v.id}>
                  <Link href={`/videos/${v.id}`} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 hover:bg-[var(--color-surface-sunken)]">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{v.title}</span>
                      <span className="block truncate text-2xs text-[var(--color-ink-faint)]">{v.clientName}{v.dueOn ? ` · ${formatDate(v.dueOn)}` : ""}</span>
                    </span>
                    <Badge tone={VIDEO_STATUS[v.status as VideoStage]?.tone ?? "neutral"}>{VIDEO_STATUS[v.status as VideoStage]?.short ?? v.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}
