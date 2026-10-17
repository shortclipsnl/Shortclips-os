import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarCheck, CheckCircle2 } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getMonthShootStats, getShootOverview, listProductionDays, listVideographerOptions, nextShootPerClient } from "@/server/productions";
import { ProdStatusCell, VideographerCell } from "./prod-cells";
import { Badge, Card, ClientLogo, EmptyState, PageHeader, Stat } from "@/components/ui";
import { daysUntil, formatDate, formatDateFull, plural, relativeDays } from "@/lib/format";
import { PRODUCTION_STATUS } from "@/lib/statuses";

export const metadata: Metadata = { title: "Opnameplanning" };
export const dynamic = "force-dynamic";

/** Projectfase die automatisch meeloopt met de opnamedatum. */
const PHASE_LABEL: Record<string, string> = {
  nieuw: "Nieuw",
  scripting: "Scripting",
  opnamevoorbereiding: "Voorbereiding",
  opname: "Opnamedag",
  editing: "Editing",
};

export default async function ProductionsPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const viewer = await requireInternal();
  const params = await searchParams;
  const when =
    params.periode === "verleden" ? "verleden" : params.periode === "deze-week" ? "deze-week" : "komend";
  const todayStr = new Date().toISOString().slice(0, 10);
  const [rows, monthStats, nextPerClient, overview, videographers] = await Promise.all([
    listProductionDays(viewer, when),
    getMonthShootStats(viewer),
    nextShootPerClient(viewer),
    getShootOverview(viewer),
    listVideographerOptions(),
  ]);
  const canWriteProd = viewer.permissions.has("productions:write");
  const komend = await listProductionDays(viewer, "komend");
  const next = komend[0] ?? null;
  const monthLabel = new Date(`${monthStats.month}-01`).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Opnameplanning"
        description="Gesynchroniseerd vanuit Google Agenda"
        actions={
          <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5">
            {([
              { key: "deze-week", label: "Deze week", href: "/productions?periode=deze-week" },
              { key: "komend", label: "Komend", href: "/productions" },
              { key: "verleden", label: "Geweest", href: "/productions?periode=verleden" },
            ] as const).map((opt) => (
              <Link
                key={opt.key}
                href={opt.href}
                className={
                  when === opt.key
                    ? "rounded-[4px] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
                    : "px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)]"
                }
              >
                {opt.label}
              </Link>
            ))}
          </div>
        }
      />

      {/* Overzicht: deze week / deze maand / eerstvolgende + per videograaf. */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Deze week" value={overview.thisWeek} hint="komende 7 dagen" href="/productions?periode=deze-week" />
        <Stat label={`Gepland in ${monthLabel}`} value={monthStats.planned} href="/productions?periode=komend" />
        <Stat label="Afgerond deze maand" value={monthStats.completed} tone={monthStats.completed > 0 ? "good" : undefined} href="/productions?periode=verleden" />
        <Stat
          label="Eerstvolgende opname"
          value={next ? new Date(next.scheduledOn).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "—"}
          hint={next ? next.clientName : "niets gepland"}
          href={next ? "/productions?periode=deze-week" : undefined}
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
                    <ClientLogo name={n.clientName} logoUrl={n.clientLogo} color={n.clientColor} size={24} />
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
            title={
              when === "deze-week"
                ? "Geen opnames deze week (ma t/m zo)"
                : when === "komend"
                  ? "Geen opnamedagen gepland"
                  : "Geen opnamedagen in het verleden"
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((d) => {
            const days = daysUntil(d.scheduledOn);
            const blockers = Number(d.openBlockers) + Number(d.unapprovedScripts);
            const atRisk = when !== "verleden" && days <= 2 && days >= 0 && blockers > 0;
            const isToday = d.scheduledOn === todayStr;
            return (
              <Link key={d.id} href={`/productions/${d.id}`} className="block">
                <Card
                  className={
                    isToday
                      ? "ring-2 ring-[var(--color-indigo-ink)] transition-shadow hover:shadow-[var(--shadow-raised)]"
                      : atRisk
                        ? "border-[var(--color-bad)]/30 transition-shadow hover:shadow-[var(--shadow-raised)]"
                        : "transition-shadow hover:shadow-[var(--shadow-raised)]"
                  }
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className={`w-16 shrink-0 rounded-[var(--radius-md)] py-2 text-center ${isToday ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-sunken)]"}`}>
                        <p className={`text-2xs tracking-wide uppercase ${isToday ? "text-white/70" : "text-[var(--color-ink-faint)]"}`}>
                          {isToday ? "Vandaag" : new Date(d.scheduledOn).toLocaleDateString("nl-NL", { month: "short" })}
                        </p>
                        <p className="text-xl leading-tight font-semibold tabular-nums">
                          {new Date(d.scheduledOn).getDate()}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <ClientLogo name={d.clientName} logoUrl={d.clientLogo} color={d.clientColor} size={22} />
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
                      {canWriteProd ? (
                        <ProdStatusCell id={d.id} status={d.status} />
                      ) : (
                        <Badge tone={PRODUCTION_STATUS[d.status]?.tone ?? "neutral"}>
                          {PRODUCTION_STATUS[d.status]?.label ?? d.status}
                        </Badge>
                      )}
                      {canWriteProd ? (
                        <VideographerCell id={d.id} videographerId={d.videographerId} options={videographers} />
                      ) : null}
                      <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-2xs font-medium text-[var(--color-ink-muted)]" title="Projectfase (loopt automatisch mee met de opnamedatum)">
                        {PHASE_LABEL[d.phase] ?? d.phase}
                      </span>
                      {when !== "verleden" ? (
                        <span className="text-xs text-[var(--color-ink-muted)]">
                          {relativeDays(d.scheduledOn)}
                        </span>
                      ) : null}
                      {atRisk ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-bad)]">
                          <AlertTriangle className="size-3.5" />
                          {plural(blockers, "punt open", "punten open")}
                        </span>
                      ) : blockers > 0 && when !== "verleden" ? (
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
