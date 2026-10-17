import type { Metadata } from "next";
import { requireInternal } from "@/server/auth/context";
import { getPlanningOverview, planningFilterOptions } from "@/server/planning-overview";
import { PageHeader } from "@/components/ui";
import { PlanningBoard } from "./planning-board";

export const metadata: Metadata = { title: "Productieplanning" };
export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const viewer = await requireInternal();
  const [weeks, options] = await Promise.all([getPlanningOverview(viewer, 8), planningFilterOptions(viewer)]);

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Productieplanning"
        description="Opnames, opleveringen en publicaties per week voor de komende acht weken. Conflicten (een editor met te veel opleveringen in één week) en afwezigheid worden automatisch gemarkeerd."
      />
      <PlanningBoard weeks={weeks} clientOptions={options.clients} />
    </div>
  );
}
