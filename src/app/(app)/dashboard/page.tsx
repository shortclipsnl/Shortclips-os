import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  FileWarning,
  Send,
} from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getDashboard } from "@/server/dashboard";
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Stat,
} from "@/components/ui";
import {
  daysSince,
  daysUntil,
  euro,
  formatDate,
  periodLabel,
  plural,
  relativeDays,
} from "@/lib/format";
import {
  PLATFORM,
  RISK_LEVEL,
  SCRIPT_STATUS,
  VIDEO_STATUS,
  type VideoStage,
} from "@/lib/statuses";
import { PipelineStrip } from "./pipeline-strip";
import { EditorDashboard } from "./editor-view";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const viewer = await requireInternal();

  // Editors krijgen een eigen, smaller dashboard met uitsluitend hun werk.
  if (viewer.isEditorOnly) return <EditorDashboard viewer={viewer} />;

  const data = await getDashboard(viewer);
  const canSeeFinance = viewer.permissions.has("finance:read");

  const firstName = viewer.fullName.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "Goedenacht" : hour < 12 ? "Goedemorgen" : hour < 18 ? "Goedemiddag" : "Goedenavond";

  const urgentShoots = data.shoots.filter(
    (s) => daysUntil(s.scheduledOn) <= 2 && (Number(s.openBlockers) > 0 || Number(s.unapprovedScripts) > 0),
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Kop */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {periodLabel(data.period)} · {data.clients.active} actieve klanten ·{" "}
            {data.videos.open} video&apos;s in productie
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/videos" variant="secondary" size="sm">
            Video pipeline
          </LinkButton>
          <LinkButton href="/clients" size="sm">
            Klanten
          </LinkButton>
        </div>
      </div>

      {/* Wat vraagt nú aandacht */}
      {(urgentShoots.length > 0 ||
        data.videos.late.length > 0 ||
        (canSeeFinance && data.revenue.overdueCount > 0)) && (
        <Card className="border-[var(--color-bad)]/25 bg-[var(--color-bad-soft)]/40" padded={false}>
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-bad)]" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                Vraagt nu aandacht
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-ink-muted)]">
                {urgentShoots.map((s) => (
                  <li key={s.id}>
                    <Link href={`/productions/${s.id}`} className="hover:underline">
                      <strong className="font-medium text-[var(--color-ink)]">
                        {s.clientName}
                      </strong>{" "}
                      — opname {relativeDays(s.scheduledOn)},{" "}
                      {plural(Number(s.unapprovedScripts), "script niet goedgekeurd", "scripts niet goedgekeurd")}{" "}
                      en {plural(Number(s.openBlockers), "blokkerend checklistpunt", "blokkerende checklistpunten")} open
                    </Link>
                  </li>
                ))}
                {data.videos.late.length > 0 ? (
                  <li>
                    <Link href="/videos?filter=te-laat" className="hover:underline">
                      <strong className="font-medium text-[var(--color-ink)]">
                        {plural(data.videos.late.length, "video", "video's")}
                      </strong>{" "}
                      {data.videos.late.length === 1 ? "staat" : "staan"} over de deadline
                    </Link>
                  </li>
                ) : null}
                {canSeeFinance && data.revenue.overdueCount > 0 ? (
                  <li>
                    <Link href="/finance" className="hover:underline">
                      <strong className="font-medium text-[var(--color-ink)]">
                        {plural(data.revenue.overdueCount, "factuur", "facturen")}
                      </strong>{" "}
                      vervallen ({euro(data.revenue.overdue)})
                    </Link>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Kerncijfers */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Stat
          label="Actieve klanten"
          value={data.clients.active}
          hint={data.clients.atRisk.length > 0 ? `${data.clients.atRisk.length} met aandachtspunt` : "geen risico's"}
          tone={data.clients.atRisk.length > 0 ? "warn" : "good"}
          href="/clients"
        />
        {canSeeFinance ? (
          <>
            <Stat label="Maandomzet" value={euro(data.revenue.mrr)} hint="terugkerend, actieve contracten" href="/finance" />
            <Stat
              label="Openstaand"
              value={euro(data.revenue.outstanding)}
              hint={data.revenue.overdue > 0 ? `${euro(data.revenue.overdue)} vervallen` : "niets vervallen"}
              tone={data.revenue.overdue > 0 ? "bad" : "neutral"}
              href="/finance"
            />
          </>
        ) : null}
        <Stat
          label="In productie"
          value={data.videos.open}
          hint={`${data.videos.awaitingEditor} wacht op editor`}
          href="/videos"
        />
        <Stat
          label="Bij de klant"
          value={data.videos.atClient}
          hint={
            data.videos.stalledAtClient[0]
              ? `oudste: ${daysSince(data.videos.stalledAtClient[0].statusChangedAt)} dagen`
              : "niets openstaand"
          }
          tone={data.videos.stalledAtClient.some((v) => daysSince(v.statusChangedAt) > 5) ? "warn" : "neutral"}
          href="/videos?filter=bij-klant"
        />
        <Stat
          label="Te laat"
          value={data.videos.late.length}
          hint="video's over deadline"
          tone={data.videos.late.length > 0 ? "bad" : "good"}
          href="/videos?filter=te-laat"
        />
      </div>

      {/* Pipeline */}
      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader
            title="Video pipeline"
            subtitle="Waar staat het werk vast? Klik door naar de betreffende stap."
            action={
              <Link href="/videos" className="text-sm font-medium text-[var(--color-brand-600)] hover:underline">
                Alles bekijken
              </Link>
            }
          />
        </div>
        <PipelineStrip buckets={data.pipeline} ages={Object.fromEntries(data.stageAges)} />
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Te laat + bij klant */}
        <Card className="xl:col-span-2" padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Loopt vast"
              subtitle="Video's over hun deadline of te lang bij de klant."
            />
          </div>
          {data.videos.late.length === 0 && data.videos.stalledAtClient.length === 0 ? (
            <EmptyState title="Niets loopt vast" description="Alle video's zitten binnen hun streeftijd." />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {data.videos.late.slice(0, 6).map((v) => (
                <li key={v.id}>
                  <Link href={`/videos/${v.id}`} className="sc-row-link flex items-center gap-3 px-5 py-3">
                    <Avatar name={v.clientName} color={v.clientColor} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{v.title}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                        {v.clientName} · {v.editorName ?? "geen editor"}
                      </span>
                    </span>
                    <Badge tone={VIDEO_STATUS[v.status as VideoStage]?.tone ?? "neutral"}>
                      {VIDEO_STATUS[v.status as VideoStage]?.short ?? v.status}
                    </Badge>
                    <span className="w-24 shrink-0 text-right text-xs font-medium text-[var(--color-bad)]">
                      {relativeDays(v.dueOn)}
                    </span>
                  </Link>
                </li>
              ))}
              {data.videos.stalledAtClient
                .filter((v) => daysSince(v.statusChangedAt) > 4)
                .slice(0, 4)
                .map((v) => (
                  <li key={`stall-${v.id}`}>
                    <Link href={`/videos/${v.id}`} className="sc-row-link flex items-center gap-3 px-5 py-3">
                      <Avatar name={v.clientName} color={v.clientColor} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{v.title}</span>
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                          {v.clientName}
                        </span>
                      </span>
                      <Badge tone="warn">
                        <Clock className="size-3" /> {daysSince(v.statusChangedAt)} dagen bij klant
                      </Badge>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        {/* Opnames */}
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Aankomende opnames"
              action={
                <Link href="/productions" className="text-sm font-medium text-[var(--color-brand-600)] hover:underline">
                  Alles
                </Link>
              }
            />
          </div>
          {data.shoots.length === 0 ? (
            <EmptyState
              title="Geen opnames gepland"
              description="Plan een opnamedag om de contentcyclus op gang te houden."
              icon={<CalendarClock className="size-6" />}
            />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {data.shoots.slice(0, 5).map((s) => {
                const blockers = Number(s.openBlockers) + Number(s.unapprovedScripts);
                const soon = daysUntil(s.scheduledOn) <= 2;
                return (
                  <li key={s.id}>
                    <Link href={`/productions/${s.id}`} className="sc-row-link flex items-center gap-3 px-5 py-3">
                      <Avatar name={s.clientName} color={s.clientColor} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.clientName}</span>
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                          {formatDate(s.scheduledOn)} · {s.locationName ?? "locatie onbekend"}
                        </span>
                      </span>
                      {blockers > 0 ? (
                        <Badge tone={soon ? "bad" : "warn"}>{blockers} open</Badge>
                      ) : (
                        <Badge tone="good">rond</Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Scripts */}
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Scripts wachten op goedkeuring" />
          </div>
          {data.scripts.length === 0 ? (
            <EmptyState title="Alle scripts zijn rond" icon={<FileWarning className="size-6" />} />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {data.scripts.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <Link href={`/scripts/${s.id}`} className="sc-row-link flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.title}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                        {s.clientName}
                        {s.shootOn ? ` · opname ${relativeDays(s.shootOn)}` : ""}
                      </span>
                    </span>
                    <Badge tone={SCRIPT_STATUS[s.status]?.tone ?? "neutral"}>
                      {SCRIPT_STATUS[s.status]?.label ?? s.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Publicaties deze week */}
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Deze week publiceren"
              action={
                <Link href="/calendar" className="text-sm font-medium text-[var(--color-brand-600)] hover:underline">
                  Kalender
                </Link>
              }
            />
          </div>
          {data.publishThisWeek.length === 0 ? (
            <EmptyState title="Niets ingepland deze week" icon={<Send className="size-6" />} />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {data.publishThisWeek.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={p.clientName} color={p.clientColor} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.title}</span>
                    <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                      {p.clientName} · {relativeDays(p.scheduledOn)}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {(p.platforms as string[]).slice(0, 3).map((pl) => (
                      <span
                        key={pl}
                        title={PLATFORM[pl]?.label ?? pl}
                        className="size-2 rounded-full"
                        style={{ background: PLATFORM[pl]?.color ?? "#999" }}
                      />
                    ))}
                  </span>
                  <Badge tone={p.status === "scheduled" ? "good" : p.status === "ready" ? "info" : "warn"}>
                    {p.status === "scheduled" ? "ingepland" : p.status === "ready" ? "klaar" : "voorbereiden"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Wie moet wat */}
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Wie moet wat" subtitle="Openstaande taken per persoon." />
          </div>
          {data.tasks.length === 0 ? (
            <EmptyState title="Geen openstaande taken" />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {data.tasks.map((t) => (
                <li key={t.assigneeId} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={t.assigneeName ?? "?"} size={26} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {t.assigneeName}
                  </span>
                  {Number(t.overdue) > 0 ? (
                    <Badge tone="bad">{Number(t.overdue)} te laat</Badge>
                  ) : null}
                  <span className="text-sm font-semibold tabular-nums">{Number(t.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Klanten met risico */}
        <Card padded={false} className="xl:col-span-2">
          <div className="p-5 pb-3">
            <CardHeader
              title="Klanten die aandacht vragen"
              subtitle="Risico, achterstand op de afspraak of geen opname gepland."
            />
          </div>
          {data.clients.atRisk.length === 0 && data.clients.withoutShoot.length === 0 && data.clients.quotaGap.length === 0 ? (
            <EmptyState title="Alle klanten lopen op schema" />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {data.clients.atRisk.map((c) => (
                <li key={c.id}>
                  <Link href={`/clients/${c.slug}`} className="sc-row-link flex items-start gap-3 px-5 py-3">
                    <Avatar name={c.name} color={c.color} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-[var(--color-ink-muted)]">
                        {c.riskReason ?? "Gemarkeerd als risico"}
                      </span>
                    </span>
                    <Badge tone={RISK_LEVEL[c.riskLevel]?.tone ?? "neutral"}>
                      {RISK_LEVEL[c.riskLevel]?.label ?? c.riskLevel}
                    </Badge>
                  </Link>
                </li>
              ))}
              {data.clients.quotaGap.slice(0, 4).map((q) => (
                <li key={`gap-${q.clientId}`}>
                  <Link href={`/clients/${q.clientSlug}`} className="sc-row-link flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{q.clientName}</span>
                      <span className="block text-xs text-[var(--color-ink-muted)]">
                        {q.published + q.inProgress} van {q.quota} video&apos;s deze maand in productie
                      </span>
                    </span>
                    <Badge tone="warn">{q.gap} tekort</Badge>
                  </Link>
                </li>
              ))}
              {data.clients.withoutShoot.slice(0, 4).map((c) => (
                <li key={`shoot-${c.id}`}>
                  <Link href={`/clients/${c.slug}`} className="sc-row-link flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-[var(--color-ink-muted)]">
                        Geen opnamedag gepland
                        {c.lastShoot ? ` · laatste was ${formatDate(c.lastShoot)}` : ""}
                      </span>
                    </span>
                    <Badge tone="warn">opname plannen</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          {/* Editorcapaciteit */}
          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader title="Editorbelasting" />
            </div>
            {data.editors.length === 0 ? (
              <EmptyState title="Geen lopend editwerk" />
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {data.editors.map((e) => (
                  <li key={e.editorId} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={e.editorName} size={26} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {e.editorName}
                    </span>
                    {Number(e.overdue) > 0 ? <Badge tone="bad">{Number(e.overdue)} te laat</Badge> : null}
                    <span className="text-sm font-semibold tabular-nums">{Number(e.open)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Contracten */}
          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader title="Contracten die aflopen" />
            </div>
            {data.contracts.length === 0 ? (
              <EmptyState title="Geen contracten binnen 90 dagen" />
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {data.contracts.map((c) => {
                  const days = daysUntil(c.endsOn);
                  return (
                    <li key={c.id}>
                      <Link href={`/clients/${c.clientSlug}?tab=contract`} className="sc-row-link flex items-center gap-3 px-5 py-3">
                        <Avatar name={c.clientName} color={c.clientColor} size={26} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.clientName}</span>
                          <span className="block text-xs text-[var(--color-ink-muted)]">
                            {c.autoRenew ? "verlengt automatisch" : "verlengt niet automatisch"} ·{" "}
                            {euro(c.monthlyValue)}/mnd
                          </span>
                        </span>
                        <Badge tone={days < 60 ? "bad" : "warn"}>over {days} d</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
