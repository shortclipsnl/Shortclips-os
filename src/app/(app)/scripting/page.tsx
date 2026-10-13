import type { Metadata } from "next";
import { requireInternal } from "@/server/auth/context";
import { listScripting } from "@/server/scripting";
import { PageHeader, Stat } from "@/components/ui";
import { ScriptingBoard } from "./scripting-ui";

export const metadata: Metadata = { title: "Scripting" };
export const dynamic = "force-dynamic";

export default async function ScriptingPage() {
  const viewer = await requireInternal();
  const canWrite = viewer.permissions.has("scripts:write");
  const { rows, stats, clientOptions } = await listScripting(viewer);

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Scripting"
        description="Alle aankomende opnames en hun scripting in één overzicht — automatisch gekoppeld aan de opnameplanning. Scripts moeten uiterlijk 7 dagen vóór de opname klaar zijn."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Aankomende opnames" value={String(stats.upcoming)} />
        <Stat label="Nog niet afgerond" value={String(stats.notDone)} tone={stats.notDone > 0 ? "info" : "good"} />
        <Stat label="Deadline nadert" value={String(stats.deadlineSoon)} tone={stats.deadlineSoon > 0 ? "warn" : "good"} hint="binnen 7 dagen" />
        <Stat label="Te laat" value={String(stats.late)} tone={stats.late > 0 ? "bad" : "good"} />
      </div>

      <ScriptingBoard rows={rows} clientOptions={clientOptions} canWrite={canWrite} />
    </div>
  );
}
