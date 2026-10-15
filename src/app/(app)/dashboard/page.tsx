import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Clock } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { checklistChecks, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { getDashboard, getDashboardTopStats } from "@/server/dashboard";
import { Avatar, Badge, Card, CardHeader, EmptyState, LinkButton } from "@/components/ui";
import {
  daysSince,
  daysUntil,
  formatDate,
  periodLabel,
  plural,
  relativeDays,
} from "@/lib/format";
import { RISK_LEVEL, VIDEO_STATUS, type VideoStage } from "@/lib/statuses";
import { getMyDay } from "@/server/my-day";
import { activeClientsMissingCoordinator } from "@/server/clients";
import { isOwner } from "@/server/auth/context";
import { editorCapacityMap } from "@/server/metrics";
import { editorLoad, LOAD_LABEL } from "@/lib/metrics";
import { PipelineStrip } from "./pipeline-strip";
import { EditorDashboard } from "./editor-view";
import { DayScheduleStrip } from "./day-schedule";
import { MyDayCard } from "./my-day-card";
import { AttentionPopups, type Signal } from "./attention-popups";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const viewer = await requireInternal();

  // Editors krijgen een eigen, smaller dashboard met uitsluitend hun werk.
  if (viewer.isEditorOnly) return <EditorDashboard viewer={viewer} />;

  const [data, top, myDay, capMap] = await Promise.all([getDashboard(viewer), getDashboardTopStats(viewer), getMyDay(viewer), editorCapacityMap()]);
  const missingCoord = isOwner(viewer) ? await activeClientsMissingCoordinator() : { count: 0, names: [] };

  // Dagchecklist: bevestigingen van vandaag (NL-kalenderdag), gedeeld met het team.
  const todayNL = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const checkRows = await db
    .select({ slotKey: checklistChecks.slotKey, name: users.fullName, at: checklistChecks.confirmedAt })
    .from(checklistChecks)
    .leftJoin(users, eq(users.id, checklistChecks.confirmedById))
    .where(eq(checklistChecks.onDate, todayNL));
  const checks = Object.fromEntries(checkRows.map((r) => [r.slotKey, { name: r.name ?? "iemand", at: r.at.toISOString() }]));

  const firstName = viewer.fullName.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "Goedenacht" : hour < 12 ? "Goedemorgen" : hour < 18 ? "Goedemiddag" : "Goedenavond";

  const urgentShoots = data.shoots.filter(
    (s) => daysUntil(s.scheduledOn) <= 2 && (Number(s.openBlockers) > 0 || Number(s.unapprovedScripts) > 0),
  );

  // Signalen voor de pop-up meldingen: urgent (rood) blijft terugkomen tot opgelost.
  const popupSignals: Signal[] = [
    ...data.videos.late.map((v) => ({
      id: `late-${v.id}`,
      severity: "urgent" as const,
      title: "Video over de deadline",
      detail: `${v.clientName} — ${v.title} staat ${Math.max(1, -daysUntil(v.dueOn))} dag(en) over de deadline.`,
      href: `/videos/${v.id}`,
    })),
    ...data.videos.stalledAtClient
      .filter((v) => daysSince(v.statusChangedAt) > 3)
      .map((v) => ({
        id: `stall-${v.id}`,
        severity: "warn" as const,
        title: "Klant reageert niet",
        detail: `${v.clientName} — ${v.title}: al ${daysSince(v.statusChangedAt)} werkdagen geen feedback.`,
        href: `/videos/${v.id}`,
      })),
    ...urgentShoots.map((s) => ({
      id: `shoot-${s.id}`,
      severity: "warn" as const,
      title: "Opname nog voorbereiden",
      detail: `${s.clientName} — opname ${relativeDays(s.scheduledOn)} is nog niet rond.`,
      href: `/productions/${s.id}`,
    })),
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <AttentionPopups signals={popupSignals} />
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

      {/* Blokkerend: actieve klanten zonder verantwoordelijke (alleen eigenaar). */}
      {missingCoord.count > 0 ? (
        <Link href="/clients" className="block rounded-[var(--radius-lg)] border border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)] px-4 py-3 text-sm hover:brightness-[0.99]">
          <strong className="font-semibold text-[#a3271c]">{missingCoord.count} actieve klant{missingCoord.count === 1 ? "" : "en"} zonder verantwoordelijke.</strong>{" "}
          <span className="text-[var(--color-ink-muted)]">Wijs een Content Creative toe — {missingCoord.names.slice(0, 6).join(", ")}{missingCoord.names.length > 6 ? "…" : ""}.</span>
        </Link>
      ) : null}

      {/* Mijn dag — eigen opnames, taken en editwerk van de ingelogde persoon. */}
      {myDay.hasAny ? <MyDayCard day={myDay} firstName={firstName} /> : null}

      {/* Wat vraagt nú aandacht — prominent, met reden, verantwoordelijke, dagen en directe link. */}
      {(() => {
        const stalledClient = data.videos.stalledAtClient.filter((v) => daysSince(v.statusChangedAt) > 3);
        const count = data.videos.late.length + stalledClient.length + urgentShoots.length;
        if (count === 0) return null;
        return (
          <Card padded={false} className="overflow-hidden border-[var(--color-bad)]/40 ring-1 ring-[var(--color-bad)]/20">
            <div className="flex items-center gap-2.5 bg-[var(--color-bad)] px-5 py-3 text-white">
              <AlertTriangle className="size-5 shrink-0" strokeWidth={2.25} />
              <h2 className="text-base font-bold tracking-tight">Vraagt nu aandacht</h2>
              <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-semibold">{count}</span>
            </div>
            <ul className="divide-y divide-[var(--color-line)]">
              {data.videos.late.map((v) => {
                const days = Math.max(1, -daysUntil(v.dueOn));
                return (
                  <li key={`late-${v.id}`}>
                    <Link href={`/videos/${v.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-bad-soft)]/40">
                      <span className="size-2.5 shrink-0 rounded-full bg-[var(--color-bad)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{v.clientName} — {v.title}</span>
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">Video over de deadline · {v.editorName ?? "geen editor"}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-[var(--color-bad)]">{plural(days, "dag", "dagen")} te laat</span>
                    </Link>
                  </li>
                );
              })}
              {stalledClient.map((v) => (
                <li key={`stall-${v.id}`}>
                  <Link href={`/videos/${v.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-warn-soft)]/40">
                    <span className="size-2.5 shrink-0 rounded-full bg-[var(--color-warn)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{v.clientName} — {v.title}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">Wacht op reactie van de klant</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-[var(--color-warn)]">{plural(daysSince(v.statusChangedAt), "dag", "dagen")} geen reactie</span>
                  </Link>
                </li>
              ))}
              {urgentShoots.map((s) => {
                const open = Number(s.openBlockers) + Number(s.unapprovedScripts);
                return (
                  <li key={`shoot-${s.id}`}>
                    <Link href={`/productions/${s.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-warn-soft)]/40">
                      <span className="size-2.5 shrink-0 rounded-full bg-[var(--color-warn)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.clientName} — opname {relativeDays(s.scheduledOn)}</span>
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">Opname nog niet rond · {s.videographerName ?? "geen videograaf"}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-[var(--color-warn)]">{plural(open, "punt", "punten")} open</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })()}

      {/* Kerncijfers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <NavyStat label="Actieve klanten" value={top.activeClients} hint={data.clients.atRisk.length > 0 ? `${data.clients.atRisk.length} met aandachtspunt` : "geen risico's"} href="/clients" />
        <NavyStat label="Opnames" value={top.opnamesThisWeek} hint="deze week" href="/productions" />
        <NavyStat label="Video's" value={data.videos.open} hint={`${top.inEditing} in editing`} href="/videos?filter=actief" />
        <NavyStat label="Deadlines" value={top.overDeadline} hint={`${top.dueSoon} naderen`} accent={top.overDeadline > 0 ? "var(--color-bad)" : undefined} href="/videos?filter=te-laat" />
        <NavyStat label="Openstaande taken" value={top.openTasks} hint="alle medewerkers" href="/tasks" />
      </div>

      {/* Dagindeling Shortclips — vaste dagstructuur, compact */}
      <DayScheduleStrip checks={checks} />

      {/* Pipeline — prominent, in de huisstijl */}
      <Card padded={false} className="overflow-hidden ring-1 ring-[var(--color-indigo-ink)]/15">
        <div className="flex items-center justify-between gap-2 bg-[var(--color-indigo-ink)] px-5 py-3 text-white">
          <div>
            <h2 className="text-base font-bold tracking-tight">Video pipeline</h2>
            <p className="text-xs text-white/70">Waar staat het werk vast? Klik door naar de betreffende stap.</p>
          </div>
          <Link href="/videos" className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/25">
            Alles bekijken
          </Link>
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

      {/* Editorbelasting — prominent: hoeveel werk ligt waar, en wie is overbelast. */}
      <Card padded={false} className="overflow-hidden ring-1 ring-[var(--color-indigo-ink)]/15">
        <div className="flex items-center justify-between gap-2 bg-[var(--color-indigo-ink)] px-5 py-3 text-white">
          <div>
            <h2 className="text-base font-bold tracking-tight">Editorbelasting</h2>
            <p className="text-xs text-white/70">Hoeveel video&apos;s liggen er per editor, en wie heeft nog ruimte?</p>
          </div>
          <div className="hidden shrink-0 items-center gap-3 text-2xs text-white/70 sm:flex">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--color-good)]" />normaal</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--color-warn)]" />hoog</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--color-bad)]" />overbelast</span>
          </div>
        </div>
        {data.editors.length === 0 ? (
          <EmptyState title="Geen lopend editwerk" description="Er staan nu geen video's in de editfase." />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.editors.map((e) => {
              const open = Number(e.open);
              const overdue = Number(e.overdue);
              const soon = Number(e.dueSoon);
              const cap = capMap.get(e.editorId) ?? 0;
              const { pct, level: lvl } = editorLoad(open, cap);
              const level = { label: LOAD_LABEL[lvl], color: LEVEL_COLOR[lvl]! };
              const maxOpen = Math.max(6, ...data.editors.map((x) => Number(x.open)));
              return (
                <div key={e.editorId} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={e.editorName} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{e.editorName}</div>
                      <div className="text-xs" style={{ color: level.color }}>{level.label}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold leading-none tabular-nums">{open}</div>
                      <div className="text-2xs text-[var(--color-ink-faint)]">in behandeling</div>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct ?? (open / maxOpen) * 100)}%`, background: level.color }} />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {overdue > 0 ? <Badge tone="bad">{overdue} te laat</Badge> : null}
                    {soon > 0 ? <Badge tone="warn">{soon} deadline ≤3d</Badge> : null}
                    {e.nextDue ? (
                      <span className="text-2xs text-[var(--color-ink-muted)]">eerstvolgende deadline {formatDate(e.nextDue)}</span>
                    ) : overdue === 0 && soon === 0 ? (
                      <span className="text-2xs text-[var(--color-ink-faint)]">geen deadline binnenkort</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

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
                            {c.autoRenew ? "verlengt automatisch" : "verlengt niet automatisch"}
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

const LEVEL_COLOR: Record<string, string> = {
  normaal: "var(--color-good)",
  hoog: "var(--color-warn)",
  overbelast: "var(--color-bad)",
  geen_data: "var(--color-ink-faint)",
};

function NavyStat({
  label,
  value,
  hint,
  href,
  accent,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href: string;
  accent?: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] px-4 py-4 text-white transition-shadow hover:shadow-[var(--shadow-raised)]"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-white/60">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-white/55">{hint}</div> : null}
    </Link>
  );
}
