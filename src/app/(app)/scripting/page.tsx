import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, CalendarClock, FileClock, AlarmClock, AlertTriangle } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { listScripting } from "@/server/scripting";
import { PageHeader, Stat } from "@/components/ui";
import { ScriptingBoard } from "./scripting-ui";

export const metadata: Metadata = { title: "Scripting" };
export const dynamic = "force-dynamic";

export default async function ScriptingPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const viewer = await requireInternal();
  const canWrite = viewer.permissions.has("scripts:write");
  const { rows, stats, clientOptions, writerOptions } = await listScripting(viewer);
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
    </div>
  );
}
