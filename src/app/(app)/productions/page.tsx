import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getMonthShootStats, getShootOverview, nextShootPerClient, shootsInRange } from "@/server/productions";
import { listAssignableUsers } from "@/server/clients";
import { syncCalendarIfStale } from "@/server/jobs/calendar-sync";
import { Avatar, Card, ClientLogo, PageHeader, Stat } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { ShootAgenda, type AgendaShoot } from "./shoot-agenda";
import { VideographerCell, type PersonOption } from "./prod-cells";

export const metadata: Metadata = { title: "Opnameplanning" };
export const dynamic = "force-dynamic";

export default async function ProductionsPage() {
  const viewer = await requireInternal();
  // Google Agenda op de achtergrond verversen als de laatste sync >1u geleden is.
  await syncCalendarIfStale();

  // Ruim venster voor de agenda: 2 maanden terug t/m ~6 maanden vooruit.
  const s = new Date();
  s.setMonth(s.getMonth() - 2, 1);
  const e = new Date();
  e.setMonth(e.getMonth() + 6, 1);
  const startIso = s.toLocaleDateString("en-CA");
  const endIso = e.toLocaleDateString("en-CA");
  const todayIso = new Date().toLocaleDateString("en-CA");

  const canAssign = viewer.permissions.has("productions:write");
  const [shoots, monthStats, nextPerClient, overview, assignable] = await Promise.all([
    shootsInRange(viewer, startIso, endIso),
    getMonthShootStats(viewer),
    nextShootPerClient(viewer),
    getShootOverview(viewer),
    canAssign ? listAssignableUsers() : Promise.resolve([]),
  ]);

  // Wie kan een opname draaien: videografen (en wie óók shoots doet binnen het
  // kleine team). Zo kun je de videograaf direct hier koppelen i.p.v. losse boards.
  const videographerOptions: PersonOption[] = assignable
    .filter((u) => ["videographer", "content_creator", "owner", "admin"].includes(u.primaryRole))
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
    videographerName: x.videographerName,
  }));

  const monthLabel = new Date(`${monthStats.month}-01`).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  const next = shoots.find((x) => x.scheduledOn >= todayIso) ?? null;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Opnameplanning" description="Agenda — gesynchroniseerd vanuit Google Agenda" />

      {/* Gekleurde statusblokken. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Deze week" value={overview.thisWeek} hint="komende 7 dagen" tone="info" />
        <Stat label={`Gepland in ${monthLabel}`} value={monthStats.planned} tone="lime" />
        <Stat label="Afgerond deze maand" value={monthStats.completed} tone={monthStats.completed > 0 ? "good" : "neutral"} />
        <Stat
          label="Eerstvolgende opname"
          value={next ? new Date(next.scheduledOn).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "—"}
          hint={next ? next.clientName : "niets gepland"}
          tone={next ? "warn" : "neutral"}
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

      {/* De agenda zelf: per week (ma–zo dag-indeling) of per maand, doorbladerbaar.
          Start op de week van de eerstvolgende opname, niet op een lege "deze week". */}
      <div className="mb-6">
        <ShootAgenda shoots={agendaShoots} initialDate={next?.scheduledOn} />
      </div>

      {nextPerClient.length > 0 ? (
        <Card className="mb-5 overflow-hidden" padded={false}>
          <div className="bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-bold tracking-tight text-white">Volgende opname per klant</div>
          {/* Kolomkoppen: klant · videograaf · datum. Videograaf erbij zodat
              Rutger direct ziet wie welke opname draait. */}
          <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] sm:grid-cols-[1.4fr_1fr_auto]">
            <span>Klant</span>
            <span className="hidden sm:block">Videograaf</span>
            <span className="text-right">Opname</span>
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {nextPerClient.map((n) => (
              <li key={n.clientId}>
                <Link href={`/clients/${n.clientSlug}?tab=opnames`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-2)] sm:grid-cols-[1.4fr_1fr_auto]">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ClientLogo name={n.clientName} logoUrl={n.clientLogo} color={n.clientColor} size={24} />
                    <span className="truncate font-medium">{n.clientName}</span>
                  </span>
                  <span className="order-last col-span-2 flex items-center gap-2 sm:order-none sm:col-span-1">
                    {canAssign && videographerOptions.length > 0 ? (
                      <>
                        {n.videographerName ? <Avatar name={n.videographerName} size={22} /> : null}
                        <VideographerCell id={n.id} videographerId={n.videographerId} options={videographerOptions} />
                      </>
                    ) : n.videographerName ? (
                      <>
                        <Avatar name={n.videographerName} size={22} />
                        <span className="truncate text-sm text-[var(--color-ink)]">{n.videographerName}</span>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)]/60 px-2 py-0.5 text-xs font-medium text-[#8a5300]">
                        ⚠ Nog geen videograaf
                      </span>
                    )}
                  </span>
                  <span className="flex items-center justify-end gap-2 text-sm text-[var(--color-ink-muted)]">
                    <CalendarCheck className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                    <span className="tabular-nums">{formatDate(n.scheduledOn)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
