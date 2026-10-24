import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { PageHeader } from "@/components/ui";
import { DEADLINE_SETTING_DEFS, getDeadlineSettings } from "@/server/deadline-settings";
import { DeadlinesForm } from "./deadlines-form";

export const metadata: Metadata = { title: "Deadline-termijnen" };
export const dynamic = "force-dynamic";

export default async function DeadlineSettingsPage() {
  await requirePermission("settings:write");
  const current = await getDeadlineSettings();

  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeader
        title="Deadline-termijnen"
        description="Stel de termijnen in voor de automatische deadlinebewaking: wanneer er herinnerd wordt en wanneer er wordt geëscaleerd. De herinneringen en escalaties gebruiken deze waarden meteen."
      />
      <DeadlinesForm defs={DEADLINE_SETTING_DEFS} initial={current} />
      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        De kernberekening van de deadlines zelf (interne deadline = opname + 7 werkdagen, klantdeadline = opname + 14 werkdagen) blijft vast; deze pagina stuurt de <strong>herinnerings- en escalatietermijnen</strong>. Wijzigingen gelden vanaf de eerstvolgende controle (elke nacht automatisch).
      </p>
    </div>
  );
}
