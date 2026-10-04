import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { listProductionDays } from "@/server/productions";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { daysUntil, formatDateFull, plural, relativeDays } from "@/lib/format";
import { PRODUCTION_STATUS } from "@/lib/statuses";

export const metadata: Metadata = { title: "Opnames" };
export const dynamic = "force-dynamic";

export default async function ProductionsPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const viewer = await requireInternal();
  const params = await searchParams;
  const when = params.periode === "verleden" ? "verleden" : "komend";
  const rows = await listProductionDays(viewer, when);

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Opnames"
        description={
          when === "komend"
            ? `${rows.length} geplande opnamedagen`
            : `${rows.length} afgeronde opnamedagen`
        }
        actions={
          <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5">
            <Link
              href="/productions"
              className={
                when === "komend"
                  ? "rounded-[4px] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
                  : "px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)]"
              }
            >
              Komend
            </Link>
            <Link
              href="/productions?periode=verleden"
              className={
                when === "verleden"
                  ? "rounded-[4px] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
                  : "px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)]"
              }
            >
              Geweest
            </Link>
          </div>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={when === "komend" ? "Geen opnamedagen gepland" : "Geen opnamedagen in het verleden"}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((d) => {
            const days = daysUntil(d.scheduledOn);
            const blockers = Number(d.openBlockers) + Number(d.unapprovedScripts);
            const atRisk = when === "komend" && days <= 2 && blockers > 0;
            return (
              <Link key={d.id} href={`/productions/${d.id}`} className="block">
                <Card
                  className={
                    atRisk
                      ? "border-[var(--color-bad)]/30 transition-shadow hover:shadow-[var(--shadow-raised)]"
                      : "transition-shadow hover:shadow-[var(--shadow-raised)]"
                  }
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="w-16 shrink-0 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] py-2 text-center">
                        <p className="text-2xs tracking-wide text-[var(--color-ink-faint)] uppercase">
                          {new Date(d.scheduledOn).toLocaleDateString("nl-NL", { month: "short" })}
                        </p>
                        <p className="text-xl leading-tight font-semibold tabular-nums">
                          {new Date(d.scheduledOn).getDate()}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Avatar name={d.clientName} color={d.clientColor} size={22} />
                          <span className="font-medium">{d.clientName}</span>
                        </div>
                        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                          {formatDateFull(d.scheduledOn)}
                          {d.startTime ? ` · ${d.startTime.slice(0, 5)}` : ""}
                          {d.endTime ? `–${d.endTime.slice(0, 5)}` : ""}
                          {d.locationName ? ` · ${d.locationName}` : ""}
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                          {plural(Number(d.scriptCount), "script")}
                          {d.videographerName ? ` · ${d.videographerName}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <Badge tone={PRODUCTION_STATUS[d.status]?.tone ?? "neutral"}>
                        {PRODUCTION_STATUS[d.status]?.label ?? d.status}
                      </Badge>
                      {when === "komend" ? (
                        <span className="text-xs text-[var(--color-ink-muted)]">
                          {relativeDays(d.scheduledOn)}
                        </span>
                      ) : null}
                      {atRisk ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-bad)]">
                          <AlertTriangle className="size-3.5" />
                          {plural(blockers, "punt open", "punten open")}
                        </span>
                      ) : blockers > 0 && when === "komend" ? (
                        <Badge tone="warn">{plural(blockers, "punt open", "punten open")}</Badge>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
