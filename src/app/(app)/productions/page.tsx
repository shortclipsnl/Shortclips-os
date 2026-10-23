import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getDefaultVideographer, getMonthShootStats, getShootOverview, nextShootPerClient, shootsInRange } from "@/server/productions";
import { listAssignableUsers } from "@/server/clients";
import { syncCalendarIfStale } from "@/server/jobs/calendar-sync";
import { Badge, Card, ClientLogo, PageHeader, Stat, TeamAvatar } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { SCRIPTING_STATUS } from "@/lib/statuses";
import { ShootAgenda, type AgendaShoot } from "./shoot-agenda";
import { VideographerCell, type PersonOption } from "./prod-cells";

export const metadata: Metadata = { title: "Opnameplanning" };
export const dynamic = "force-dynamic";

export default async function ProductionsPage({ searchParams }: { searchParams: Promise<{ videograaf?: string }> }) {
  const viewer = await requireInternal();
  const vgFilter = (await searchParams).videograaf?.trim() || null;
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
  const [shoots, monthStats, nextPerClient, overview, assignable, defaultVg] = await Promise.all([
    shootsInRange(viewer, startIso, endIso),
    getMonthShootStats(viewer),
    nextShootPerClient(viewer),
    getShootOverview(viewer),
    canAssign ? listAssignableUsers() : Promise.resolve([]),
    getDefaultVideographer(),
  ]);

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
  }));

  const next = shoots.find((x) => x.scheduledOn >= todayIso) ?? null;

  // Filter op videograaf (klik op een pill): toon alleen zijn/haar opnames.
  const matchesVg = (name: string | null) => !vgFilter || (name ?? defaultVg?.fullName ?? null) === vgFilter;
  const shownNext = nextPerClient.filter((n) => matchesVg(n.videographerName));
  const shownAgenda = agendaShoots.filter((a) => matchesVg(a.videographerName));

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Opnameplanning" description="Agenda — gesynchroniseerd vanuit Google Agenda" />

      {/* Gekleurde statusblokken. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Deze week" value={overview.thisWeek} hint="komende 7 dagen" tone="info" />
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
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Opnames per videograaf:</span>
          {overview.perVideographer.map((v) => {
            const active = vgFilter === v.name;
            return (
              <Link
                key={v.name}
                href={active ? "/productions" : `/productions?videograaf=${encodeURIComponent(v.name)}`}
                className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-medium transition ${active ? "bg-[var(--color-brand-600)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"}`}
                title={active ? "Toon alle opnames" : `Toon alle opnames van ${v.name.split(" ")[0]}`}
              >
                <TeamAvatar name={v.name} size={22} />
                Opnames {v.name.split(" ")[0]} · <strong>{v.count}</strong>
              </Link>
            );
          })}
          {vgFilter ? (
            <Link href="/productions" className="rounded-full border border-[var(--color-line-strong)] px-3 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Toon alle</Link>
          ) : null}
        </div>
      ) : null}

      {/* De agenda zelf: per week (ma–zo dag-indeling) of per maand, doorbladerbaar.
          Start op de week van de eerstvolgende opname, niet op een lege "deze week". */}
      <div className="mb-6">
        <ShootAgenda shoots={shownAgenda} initialDate={next?.scheduledOn} />
      </div>

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
