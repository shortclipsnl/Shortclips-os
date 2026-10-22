import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { getShowcase } from "@/server/awards/service";
import { PageHeader } from "@/components/ui";
import { ShowcaseView } from "./showcase-view";

export const metadata: Metadata = { title: "Showcase" };
export const dynamic = "force-dynamic";

export default async function ShowcasePage() {
  const viewer = await requireInternal();
  // Uitsluitend voor editors — het team/de eigenaar heeft hier niets te zoeken.
  if (viewer.primaryRole !== "editor") redirect("/dashboard");

  const data = await getShowcase(viewer.id);
  return (
    <div className="mx-auto max-w-[920px]">
      <PageHeader title="Showcase" description="Jouw opgeleverde shorts en behaalde awards." />
      <ShowcaseView data={data} ownView editors={[]} selectedEditorId={viewer.id} />
    </div>
  );
}
