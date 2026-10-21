import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, CalendarClock, FileClock, AlarmClock, AlertTriangle } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { listScripting } from "@/server/scripting";
import { syncCalendarIfStale } from "@/server/jobs/calendar-sync";
import { Card, CardHeader, ClientLogo, PageHeader, Stat, TeamAvatar } from "@/components/ui";
import { ScriptingBoard } from "./scripting-ui";

export const metadata: Metadata = { title: "Scripting" };
export const dynamic = "force-dynamic";

export default async function ScriptingPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const viewer = await requireInternal();
  // Scripting leest dezelfde opnames (production_days) als de opnameplanning, dus
  // ook hier de Google Agenda op de achtergrond verversen als 'ie >20 min oud is.
  await syncCalendarIfStale();
  const canWrite = viewer.permissions.has("scripts:write");
  const { rows, stats, clientOptions, writerOptions, clientResponsibles } = await listScripting(viewer);
  const filter = (await searchParams).filter;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Scripting"
        description="Alle aankomende opnames en hun scripting in één overzicht — automatisch gekoppeld aan de opnameplanning. Scripts moeten uiterlijk 7 dagen vóór de opname klaar zijn."
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
          <ul className="grid gap-px bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-3">
            {clientResponsibles.map((c) => (
              <li key={c.clientSlug} className="flex items-center gap-3 bg-[var(--color-surface)] px-4 py-3">
                <ClientLogo name={c.clientName} logoUrl={c.clientLogo} color={c.clientColor} size={22} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.clientName}</span>
                {c.responsibleName ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <TeamAvatar name={c.responsibleName} avatarUrl={c.responsibleAvatar} size={20} />
                    <span className="text-sm text-[var(--color-ink-muted)]">{c.responsibleName.split(" ")[0]}</span>
                  </span>
                ) : (
                  <span className="shrink-0 text-xs font-medium text-[var(--color-warn)]">nog niet ingesteld</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
