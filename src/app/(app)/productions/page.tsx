import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarCheck, CheckCircle2 } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getMonthShootStats, getShootOverview, listProductionDays, nextShootPerClient } from "@/server/productions";
import { Avatar, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { daysUntil, formatDate, formatDateFull, plural, relativeDays } from "@/lib/format";
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
  const [rows, monthStats, nextPerClient, overview] = await Promise.all([
    listProductionDays(viewer, when),
    getMonthShootStats(viewer),
    nextShootPerClient(viewer),
    getShootOverview(viewer),
  ]);
  const komend = await listProductionDays(viewer, "komend");
  const next = komend[0] ?? null;
  const monthLabel = new Date(`${monthStats.month}-01`).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Opnames"
        description="Gesynchroniseerd vanuit Google Agenda"
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

      {/* Overzicht: deze week / deze maand / eerstvolgende + per videograaf. */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Deze week" value={overview.thisWeek} hint="komende 7 dagen" href="/productions" />
        <Stat label={`Gepland in ${monthLabel}`} value={monthStats.planned} />
        <Stat label="Afgerond deze maand" value={monthStats.completed} tone={monthStats.completed > 0 ? "good" : undefined} />
        <Stat
          label="Eerstvolgende opname"
          value={next ? new Date(next.scheduledOn).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "—"}
          hint={next ? next.clientName : "niets gepland"}
        />
      </div>

      {overview.perVideographer.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Deze maand per videograaf:</span>
          {overview.perVideographer.map((v) => (
            <span key={v.name} className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-xs">
              {v.name} · <strong>{v.count}</strong>
            </span>
          ))}
        </div>
      ) : null}

      <Card
        className={`mb-5 ${monthStats.allDone ? "border-[var(--color-good)]/30 bg-[var(--color-good-soft)]/40" : "border-[var(--color-bad)]/25 bg-[var(--color-bad-soft)]/40"}`}
      >
        <div className="flex items-start gap-3 text-sm">
          {monthStats.allDone ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--color-good)]" strokeWidth={1.75} />
          ) : (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-bad)]" strokeWidth={1.75} />
          )}
          <p>
            {monthStats.allDone
              ? `Alle opnames die deze maand al gepland stonden, zijn uitgevoerd.`
              : `${monthStats.pastNotDone} opname${monthStats.pastNotDone === 1 ? "" : "s"} die deze maand had${monthStats.pastNotDone === 1 ? "" : "den"} moeten plaatsvinden, ${monthStats.pastNotDone === 1 ? "is" : "zijn"} nog niet afgerond.`}
          </p>
        </div>
      </Card>

      {nextPerClient.length > 0 ? (
        <Card className="mb-5 overflow-hidden" padded={false}>
          <div className="bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-bold tracking-tight text-white">Volgende opname per klant</div>
          <ul className="mt-2 divide-y divide-[var(--color-line)]">
            {nextPerClient.map((n) => (
              <li key={n.clientId}>
                <Link
                  href={`/clients/${n.clientSlug}?tab=opnames`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-2)]"
                >
                  <span className="flex items-center gap-2.5">
                    <Avatar name={n.clientName} color={n.clientColor} size={24} />
                    <span className="font-medium">{n.clientName}</span>
                  </span>
                  <span className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                    <CalendarCheck className="size-4 text-[var(--color-ink-faint)]" />
                    {formatDate(n.scheduledOn)}
                    {n.videographerName ? ` · ${n.videographerName}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

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
