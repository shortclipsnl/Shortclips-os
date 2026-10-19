import type { Metadata } from "next";
import { requireInternal } from "@/server/auth/context";
import { getPlanningOverview, planningFilterOptions } from "@/server/planning-overview";
import { syncCalendarIfStale } from "@/server/jobs/calendar-sync";
import { PageHeader } from "@/components/ui";
import { PlanningBoard } from "./planning-board";

export const metadata: Metadata = { title: "Productieplanning" };
export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const viewer = await requireInternal();
  // Google Agenda op de achtergrond verversen als de laatste sync >1u geleden is.
  await syncCalendarIfStale();
  // Planning loopt door tot en met het einde van dit jaar (minimaal 8 weken),
  // zodat je naar beneden kunt scrollen tot de laatste week van december.
  const now = new Date();
  const eoy = new Date(now.getFullYear(), 11, 31);
  // ceil() neemt de week waarin 31 dec valt al mee; geen extra week nodig.
  const weeksToEoy = Math.ceil((eoy.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const weekCount = Math.max(8, weeksToEoy);
  const [weeks, options] = await Promise.all([getPlanningOverview(viewer, weekCount), planningFilterOptions(viewer)]);

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Productieplanning"
        description="Opnames, opleveringen en publicaties per week tot het einde van het jaar — scroll naar beneden voor de latere weken. Deze week staat groen bovenaan en elke maand heeft een eigen kleur. Conflicten (een editor met te veel opleveringen in één week) en afwezigheid worden automatisch gemarkeerd."
      />
      <PlanningBoard weeks={weeks} clientOptions={options.clients} />
    </div>
  );
}
