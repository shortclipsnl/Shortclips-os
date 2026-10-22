import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOwner, requireInternal } from "@/server/auth/context";
import { getGoalsOverview } from "@/server/goals/overview";
import { PageHeader } from "@/components/ui";
import { DoelenBoard } from "./doelen-board";

export const metadata: Metadata = { title: "Doelen" };
export const dynamic = "force-dynamic";

export default async function DoelenPage() {
  const viewer = await requireInternal();
  // Editors zien geen doelen.
  if (viewer.isEditorOnly) redirect("/dashboard");

  const overview = await getGoalsOverview(viewer);
  const owner = isOwner(viewer);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Doelen"
        description={`Q4 2026 · 1 okt - 31 dec · week ${overview.weekOfQuarter} van ${overview.totalWeeks} · ${overview.quarterPct}% van het kwartaal voorbij`}
      />
      <DoelenBoard overview={overview} isOwner={owner} />
    </div>
  );
}
