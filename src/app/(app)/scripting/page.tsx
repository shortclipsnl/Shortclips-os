import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, CalendarClock, FileClock, AlarmClock, AlertTriangle } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { listScripting } from "@/server/scripting";
import { upcomingScriptAppointments } from "@/server/appointments";
import { syncCalendarIfStale } from "@/server/jobs/calendar-sync";
import { Card, CardHeader, ClientLogo, LinkButton, PageHeader, Stat, TeamAvatar } from "@/components/ui";
import { ScriptingBoard } from "./scripting-ui";

export const metadata: Metadata = { title: "Scripting" };
export const dynamic = "force-dynamic";
// De batch-generator (6 concepten) doet meerdere AI-aanroepen; ruim de tijd geven.
export const maxDuration = 300;

export default async function ScriptingPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const viewer = await requireInternal();
  // Scripting leest dezelfde opnames (production_days) als de opnameplanning, dus
  // ook hier de Google Agenda op de achtergrond verversen als 'ie >20 min oud is.
  await syncCalendarIfStale();
  const canWrite = viewer.permissions.has("scripts:write");
  const canUseGenerator = viewer.permissions.has("ai:read");
  const { rows, stats, clientOptions, writerOptions, clientResponsibles } = await listScripting(viewer);
  const scriptAppts = await upcomingScriptAppointments();
  const filter = (await searchParams).filter;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Scripting"
        description="Alle aankomende opnames en hun scripting in één overzicht — automatisch gekoppeld aan de opnameplanning. Scripts moeten uiterlijk 7 dagen vóór de opname klaar zijn."
        actions={canUseGenerator ? <LinkButton href="/ai/scriptgenerator">✍️ Ga script schrijven</LinkButton> : undefined}
      />

      {/* Klikbare statusblokken: openen direct de bijbehorende filter hieronder. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Aankomende opnames" value={String(stats.upcoming)} tone="info" icon={<CalendarClock />} href="/scripting?filter=alle" />
        <Stat label="Nog niet afgerond" value={String(stats.notDone)} tone={stats.notDone > 0 ? "warn" : "good"} icon={<FileClock />} href="/scripting?filter=niet-afgerond" />
        <Stat label="Deadline nadert" value={String(stats.deadlineSoon)} tone={stats.deadlineSoon > 0 ? "lime" : "good"} icon={<AlarmClock />} hint="binnen 7 dagen" href="/scripting?filter=nadert" />
        <Stat label="Te laat" value={String(stats.late)} tone={stats.late > 0 ? "bad" : "good"} icon={<AlertTriangle />} href="/scripting?filter=te-laat" />
      </div>

      {viewer.permissions.has("video_intelligence:read") ? (
        <Link href="/video-intelligence" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] hover:underline">
          <Sparkles className="size-4" /> Video-patronen per klant bekijken (input voor je script)
        </Link>
      ) : null}

      {/* Script-afspraken uit de Google-agenda (automatisch herkend en gekoppeld). */}
      {scriptAppts.length > 0 ? (
        <Card padded={false} className="mb-5">
          <CardHeader title="Aankomende script-afspraken" subtitle="Uit de agenda herkend en aan de klant gekoppeld. Tot en met eind dit jaar." className="p-5 pb-2" />
          <ul className="divide-y divide-[var(--color-line)]">
            {scriptAppts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                <ClientLogo name={a.clientName} logoUrl={a.clientLogo} color={a.clientColor} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.title || "Script-afspraak"}</span>
                  <span className="block truncate text-2xs text-[var(--color-ink-muted)]">{a.clientName}</span>
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums text-[var(--color-ink-muted)]">
                  {new Date(a.startsAt).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}
                  {!a.allDay ? <span className="block text-2xs text-[var(--color-ink-faint)]">{new Date(a.startsAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* key op de actieve filter: zo herstart het board met de juiste filter
          zodra je op een blok bovenin klikt (anders blijft de begin-filter staan). */}
      <ScriptingBoard key={filter ?? "alle"} rows={rows} clientOptions={clientOptions} writerOptions={writerOptions} canWrite={canWrite} defaultFilter={filter} />

      {/* Vaste verantwoordelijke per klant — zodat in één oogopslag duidelijk is
          wie standaard de scripts van welke klant op zich neemt. Deze persoon
          wordt ook automatisch als scriptschrijver voorgesteld bij een nieuwe
          opname. Stel de verantwoordelijke in als coördinator op de klantpagina. */}
      {clientResponsibles && clientResponsibles.length > 0 ? (
        <Card padded={false} className="mt-6">
          <CardHeader
            title="Verantwoordelijke per klant"
            subtitle="Wie neemt standaard de scripts van welke klant op zich. Deze persoon wordt automatisch voorgesteld bij nieuwe opnames; je kunt per opname hierboven altijd iemand anders kiezen."
            className="p-5 pb-2"
          />
          {(() => {
            // Gegroepeerd per verantwoordelijke: in één oogopslag wie welke klanten
            // doet. Klanten zonder verantwoordelijke staan apart onderaan.
            const groups = new Map<string, { name: string | null; avatar: string | null; clients: typeof clientResponsibles }>();
            for (const c of clientResponsibles) {
              const key = c.responsibleName ?? "__none__";
              if (!groups.has(key)) groups.set(key, { name: c.responsibleName, avatar: c.responsibleAvatar, clients: [] });
              groups.get(key)!.clients.push(c);
            }
            const ordered = [...groups.values()].sort((a, b) => {
              if (!a.name) return 1;
              if (!b.name) return -1;
              return b.clients.length - a.clients.length || a.name.localeCompare(b.name);
            });
            return (
              <div className="grid gap-3 p-4 pt-3 sm:grid-cols-2 lg:grid-cols-3">
                {ordered.map((g) => (
                  <div key={g.name ?? "none"} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
                    <div className="mb-2.5 flex items-center gap-3">
                      {g.name ? (
                        <TeamAvatar name={g.name} avatarUrl={g.avatar} size={52} />
                      ) : (
                        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-[var(--color-warn-soft)] text-lg font-bold text-[#8a5300]">!</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-bold text-[var(--color-ink)]">{g.name ? g.name.split(" ")[0] : "Nog niet ingesteld"}</span>
                        <span className="text-xs text-[var(--color-ink-muted)]">{g.clients.length} klant{g.clients.length === 1 ? "" : "en"}</span>
                      </span>
                    </div>
                    <ul className="flex flex-wrap gap-1.5">
                      {g.clients.map((c) => (
                        <li key={c.clientSlug} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-xs">
                          <ClientLogo name={c.clientName} logoUrl={c.clientLogo} color={c.clientColor} size={16} />
                          <span className="max-w-[150px] truncate">{c.clientName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })()}
        </Card>
      ) : null}
    </div>
  );
}
