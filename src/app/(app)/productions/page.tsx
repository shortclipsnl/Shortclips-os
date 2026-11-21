import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Users } from "lucide-react";
import { asc, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients as clientsTable } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { canUseFreelanceVideographers } from "@/server/freelance-videographers-access";
import { getDefaultVideographer, getShootOverview, nextShootPerClient, shootsInRange } from "@/server/productions";
import {
  getCalendarFreshness,
  getShootAvailability,
  pastShootsToConfirm,
  planningCandidates,
  reconcileShootCompletion,
  shootCounts,
} from "@/server/shoot-planning";
import { todayAmsterdam } from "@/lib/shoot-status";
import { listAssignableUsers } from "@/server/clients";
import { missingShootAppointments } from "@/server/appointments";
import { syncCalendarIfStale } from "@/server/jobs/calendar-sync";
import { Badge, Card, ClientLogo, PageHeader, Stat, TeamAvatar } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { SCRIPTING_STATUS } from "@/lib/statuses";
import { ShootAgenda, type AgendaShoot } from "./shoot-agenda";
import { VideographerCell, type PersonOption } from "./prod-cells";
import { AvailableDaysOverview, ConfirmPastShoots, PlanningCandidates, SyncBanner, dayHref } from "./planning-panels";
import { AppointmentReview, type ReviewRow } from "@/app/(app)/settings/integrations/appointment-review";

export const metadata: Metadata = { title: "Opnameplanning" };
export const dynamic = "force-dynamic";

const fmtShort = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtLong = (iso: string) => {
  const s = new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default async function ProductionsPage({ searchParams }: { searchParams: Promise<{ videograaf?: string; inplannen?: string; dag?: string }> }) {
  const viewer = await requireInternal();
  const sp = await searchParams;
  const vgFilter = sp.videograaf?.trim() || null;
  const focusDay = sp.dag && /^\d{4}-\d{2}-\d{2}$/.test(sp.dag) ? sp.dag : null;
  // Google Agenda op de achtergrond verversen als de laatste sync >5 min geleden is.
  await syncCalendarIfStale();
  // Afgeronde opnames bijwerken (alleen met bewijs: beelden in montage of verder).
  await reconcileShootCompletion().catch(() => 0);

  // Ruim venster voor de agenda: 2 maanden terug t/m ~6 maanden vooruit.
  const s = new Date();
  s.setMonth(s.getMonth() - 2, 1);
  const e = new Date();
  e.setMonth(e.getMonth() + 6, 1);
  const startIso = s.toLocaleDateString("en-CA");
  const endIso = e.toLocaleDateString("en-CA");
  const todayIso = todayAmsterdam();

  const canAssign = viewer.permissions.has("productions:write");
  const [shoots, counts, nextPerClient, overview, assignable, defaultVg, availability, freshness, toConfirm] = await Promise.all([
    shootsInRange(viewer, startIso, endIso),
    shootCounts(viewer),
    nextShootPerClient(viewer),
    getShootOverview(viewer),
    canAssign ? listAssignableUsers() : Promise.resolve([]),
    getDefaultVideographer(),
    getShootAvailability(),
    getCalendarFreshness(),
    pastShootsToConfirm(viewer),
  ]);
  const candidates = await planningCandidates(viewer, availability);
  const unconfirmed = freshness.stale;

  // Ontbrekende opnames uit Google Agenda (herkend maar geen klant, of mogelijk
  // gemist) — zodat ze zichtbaar zijn en in één klik te koppelen. Alleen voor wie
  // klanten mag beheren (die kan koppelen); anderen zien de beheer-review/melding.
  const canLink = viewer.permissions.has("clients:write");
  const [missingShoots, linkClients] = canLink
    ? await Promise.all([
        missingShootAppointments(50),
        db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable).where(isNull(clientsTable.deletedAt)).orderBy(asc(clientsTable.name)),
      ])
    : [[] as Awaited<ReturnType<typeof missingShootAppointments>>, [] as { id: string; name: string }[]];
  const missingRows: ReviewRow[] = missingShoots.map((a) => ({
    id: a.id,
    title: a.title,
    when: formatDateTime(a.startsAt),
    calendarName: a.calendarName,
    color: "var(--color-ink-faint)",
    matchConfidence: a.matchConfidence,
  }));

  // Videograaf is altijd Rutger, Jarno of een freelance videograaf (rol
  // "videographer") — de rest van het team draait geen opnames. Alleen die
  // tonen als keuze, zodat je per opname de juiste videograaf kunt koppelen.
  const VG_EMAILS = new Set(["rutger@shortclips.nl", "jarno@shortclips.nl"]);
  const videographerOptions: PersonOption[] = assignable
    .filter((u) => u.primaryRole === "videographer" || VG_EMAILS.has(u.email.toLowerCase()))
    .map((u) => ({ id: u.id, fullName: u.fullName }));

  const agendaShoots: AgendaShoot[] = shoots.map((x) => ({
    id: x.id,
    title: x.title,
    scheduledOn: x.scheduledOn,
    startTime: x.startTime,
    locationName: x.locationName,
    status: x.status,
    clientName: x.clientName,
    clientSlug: x.clientSlug,
    clientColor: x.clientColor,
    clientLogo: x.clientLogo,
    videographerName: x.videographerName ?? defaultVg?.fullName ?? null,
    scriptCount: Number(x.scriptCount ?? 0),
    scriptId: x.scriptId ?? null,
  }));

  // Eerstvolgende opname: geannuleerde en al afgeronde opnames tellen niet mee.
  const next = shoots.find((x) => x.scheduledOn >= todayIso && x.status !== "cancelled" && x.status !== "completed") ?? null;
  const nextVg = next ? (next.videographerName ?? defaultVg?.fullName ?? null) : null;

  // Filter op videograaf (klik op een pill): toon alleen zijn/haar opnames.
  const matchesVg = (name: string | null) => !vgFilter || (name ?? defaultVg?.fullName ?? null) === vgFilter;
  const shownNext = nextPerClient.filter((n) => matchesVg(n.videographerName));
  const shownAgenda = agendaShoots.filter((a) => matchesVg(a.videographerName));

  // Beschikbaarheid uit één centrale berekening (zelfde bron als het overzicht
  // onder de kalender): werkdagen deze week waarop minstens één videograaf ruimte heeft.
  const weekFree = availability.days.filter((d) => d.date <= availability.weekEnd && d.available);
  const availableByDate: Record<string, string[]> = {};
  for (const d of availability.days) {
    const names = d.perVg.filter((v) => v.state === "beschikbaar").map((v) => v.name);
    if (names.length > 0) availableByDate[d.date] = names;
  }
  const toConfirmThisMonth = toConfirm.filter((r) => String(r.scheduledOn).slice(0, 7) === todayIso.slice(0, 7)).length;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Opnameplanning"
        description="Agenda — gesynchroniseerd vanuit Google Agenda"
        actions={
          // Freelance videografen: wie we kunnen inschakelen als de vaste videograaf niet kan. Alleen intern kernteam.
          canUseFreelanceVideographers(viewer) ? (
            <Link
              href="/freelance-videografen"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-card)] transition hover:bg-[var(--color-indigo-soft)]"
            >
              <Users className="size-4" strokeWidth={2} /> Freelance videografen
            </Link>
          ) : undefined
        }
      />

      {/* Statusblokken: alle cijfers uit dezelfde centrale opnamegegevens. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Deze week"
          value={counts.week}
          hint={`${fmtShort(counts.weekStart)} - ${fmtShort(counts.weekEnd)} · ${counts.weekLeft} nog te gaan`}
          tone="info"
        />
        <Stat
          label="Afgerond deze maand"
          value={counts.completed}
          hint={
            toConfirmThisMonth > 0 ? (
              <span className="font-semibold text-[#8a5300]">{toConfirmThisMonth} nog te bevestigen</span>
            ) : (
              `${counts.plannedMonth} nog gepland deze maand`
            )
          }
          tone={counts.completed > 0 ? "good" : "neutral"}
        />
        <Stat
          label="Eerstvolgende opname"
          value={next ? fmtShort(next.scheduledOn) : "-"}
          hint={next ? `${next.clientName}${nextVg ? ` · ${nextVg.split(" ")[0]}` : ""}` : "niets gepland"}
          tone={next ? "info" : "neutral"}
        />
        <Stat
          label="Beschikbare dagen deze week"
          value={weekFree.length}
          hint={
            weekFree.length === 0 ? (
              "geen werkdag meer vrij deze week"
            ) : (
              <span className="flex flex-col gap-0.5">
                <span>{weekFree.length} werkdag{weekFree.length === 1 ? "" : "en"} beschikbaar{unconfirmed ? " (onbevestigd)" : ""}</span>
                {weekFree.map((d) => (
                  <Link key={d.date} href={dayHref(d.date)} className="font-semibold text-[var(--color-ink)] underline-offset-2 hover:underline">
                    {fmtLong(d.date)}
                  </Link>
                ))}
              </span>
            )
          }
          tone={unconfirmed ? "warn" : weekFree.length > 0 ? "good" : "neutral"}
          icon={<CalendarCheck />}
        />
      </div>

      {unconfirmed ? (
        <SyncBanner lastSuccessAt={freshness.lastSuccessAt} lastError={freshness.lastError} canFix={viewer.permissions.has("clients:write")} />
      ) : null}

      <ConfirmPastShoots rows={toConfirm.map((r) => ({ ...r, scheduledOn: String(r.scheduledOn).slice(0, 10) }))} canWrite={canAssign} />

      {/* Mogelijk ontbrekende opnames uit Google Agenda: herkend maar nog niet
          gekoppeld, of mogelijk gemist. In één klik aan een klant koppelen →
          verschijnt direct als opname in de planning. Alleen zichtbaar als er
          daadwerkelijk iets te koppelen is. */}
      {canLink && missingRows.length > 0 ? (
        <Card className="mb-4 border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)]/40">
          <div className="flex items-center gap-2">
            <CalendarCheck className="size-4 text-[var(--color-warn)]" />
            <h2 className="text-sm font-bold text-[var(--color-ink)]">
              {missingRows.length} opname{missingRows.length === 1 ? "" : "s"} uit Google Agenda nog niet in de planning
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Deze afspraken staan wél in Google Agenda, maar konden niet automatisch aan een klant worden gekoppeld. Koppel ze hier in één klik — daarna verschijnen ze meteen als opname in de planning en op de editing-boards.
          </p>
          <AppointmentReview rows={missingRows} clients={linkClients} />
        </Card>
      ) : null}

      {overview.perVideographer.length > 0 ? (
        <div className="mb-4">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Opnames per videograaf</span>
          <div className="flex flex-wrap items-center gap-2.5">
            {overview.perVideographer.map((v) => {
              const active = vgFilter === v.name;
              return (
                <Link
                  key={v.name}
                  href={active ? "/productions" : `/productions?videograaf=${encodeURIComponent(v.name)}`}
                  className={`inline-flex items-center gap-3 rounded-full border py-1.5 pl-1.5 pr-5 transition ${active ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white shadow-[var(--shadow-card)]" : "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:border-[var(--color-brand-500)] hover:bg-[var(--color-surface-sunken)]"}`}
                  title={active ? "Toon alle opnames" : `Toon alle opnames van ${v.name.split(" ")[0]}`}
                >
                  <TeamAvatar name={v.name} avatarUrl={v.avatarUrl} size={44} />
                  <span className="leading-tight">
                    <span className="block text-sm font-bold">{v.name.split(" ")[0]}</span>
                    <span className={`block text-xs ${active ? "text-white/80" : "text-[var(--color-ink-muted)]"}`}>{v.count} opname{v.count === 1 ? "" : "s"}</span>
                  </span>
                </Link>
              );
            })}
            {vgFilter ? (
              <Link href="/productions" className="rounded-full border border-[var(--color-line-strong)] px-4 py-2 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Toon alle</Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* De agenda zelf: per week (ma–zo dag-indeling) of per maand, doorbladerbaar.
          Start op de week van de eerstvolgende opname, niet op een lege "deze week". */}
      <div id="agenda" className="mb-6 scroll-mt-4">
        <ShootAgenda
          key={focusDay ?? "start"}
          shoots={shownAgenda}
          initialDate={focusDay ?? next?.scheduledOn}
          focusDate={focusDay}
          availableByDate={availableByDate}
          availabilityUnconfirmed={unconfirmed}
        />
      </div>

      {/* Alle beschikbare opnamedagen van deze maand, per videograaf. */}
      <AvailableDaysOverview
        days={availability.days}
        videographers={availability.videographers}
        monthEnd={availability.monthEnd}
        unconfirmed={unconfirmed}
      />

      {/* Klanten zonder volgende opname: wie benaderen om lege dagen te vullen. */}
      <PlanningCandidates
        rows={candidates.map((c) => ({
          clientId: c.clientId,
          clientName: c.clientName,
          clientSlug: c.clientSlug,
          clientColor: c.clientColor,
          clientLogo: c.clientLogo,
          lastShootOn: c.lastShootOn,
          windowFrom: c.windowFrom,
          windowTo: c.windowTo,
          priority: c.priority,
          coordinatorName: c.coordinatorName,
          videographerName: c.videographerName,
          suggestedDate: c.suggestedDate,
        }))}
      />

      {shownNext.length > 0 ? (
        <Card className="mb-5 overflow-hidden" padded={false}>
          <div className="bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-bold tracking-tight text-white">Volgende opname per klant</div>
          {/* Kolomkoppen: klant · videograaf · datum. Videograaf erbij zodat
              Rutger direct ziet wie welke opname draait. */}
          <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
            <span>Klant</span>
            <span className="hidden sm:block">Videograaf</span>
            <span className="hidden sm:block">Scripting</span>
            <span className="text-right">Opname</span>
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {shownNext.map((n) => {
              const vgId = n.videographerId ?? defaultVg?.id ?? null;
              const vgName = n.videographerName ?? defaultVg?.fullName ?? null;
              return (
              <li key={n.clientId}>
                <Link href={`/clients/${n.clientSlug}?tab=opnames`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-2)] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ClientLogo name={n.clientName} logoUrl={n.clientLogo} color={n.clientColor} size={24} />
                    <span className="truncate font-medium">{n.clientName}</span>
                  </span>
                  <span className="order-last col-span-2 flex min-w-0 items-center gap-2 sm:order-none sm:col-span-1">
                    {canAssign && videographerOptions.length > 0 ? (
                      <>
                        {vgName ? <TeamAvatar name={vgName} size={22} /> : null}
                        <VideographerCell id={n.id} videographerId={vgId} options={videographerOptions} />
                      </>
                    ) : vgName ? (
                      <>
                        <TeamAvatar name={vgName} size={22} />
                        <span className="truncate text-sm text-[var(--color-ink)]">{vgName}</span>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)]/60 px-2 py-0.5 text-xs font-medium text-[#8a5300]">
                        ⚠ Nog geen videograaf
                      </span>
                    )}
                  </span>
                  {/* Scriptingstatus bij deze opname — meteen zichtbaar of het
                      script al klaar is (uit dezelfde opnamedag als het scripting-board). */}
                  <span className="hidden min-w-0 items-center overflow-hidden sm:flex">
                    <Badge tone={SCRIPTING_STATUS[n.scriptingStatus]?.done ? "good" : SCRIPTING_STATUS[n.scriptingStatus]?.tone ?? "neutral"}>
                      {SCRIPTING_STATUS[n.scriptingStatus]?.label ?? n.scriptingStatus}
                    </Badge>
                  </span>
                  <span className="flex items-center justify-end gap-2 text-sm text-[var(--color-ink-muted)]">
                    <CalendarCheck className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                    <span className="tabular-nums">{formatDate(n.scheduledOn)}</span>
                  </span>
                </Link>
              </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

