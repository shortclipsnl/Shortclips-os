import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { getShowcase, listShowcaseEditors } from "@/server/awards/service";
import { PageHeader } from "@/components/ui";
import { ShowcaseView } from "./showcase-view";

export const metadata: Metadata = { title: "Showcase" };
export const dynamic = "force-dynamic";

export default async function ShowcasePage({ searchParams }: { searchParams: Promise<{ editor?: string }> }) {
  const viewer = await requireInternal();
  // Editors zien alleen hun eigen showcase — ook server-side afgedwongen.
  if (viewer.isEditorOnly) {
    const data = await getShowcase(viewer.id);
    return (
      <div className="mx-auto max-w-[920px]">
        <PageHeader title="Showcase" description="Jouw opgeleverde shorts en behaalde awards." />
        <ShowcaseView data={data} ownView editors={[]} selectedEditorId={viewer.id} />
      </div>
    );
  }

  // Team/eigenaar: keuzelijst om de showcase van elke editor te bekijken.
  const editors = await listShowcaseEditors();
  const selected = (await searchParams).editor;
  const selectedEditorId = editors.find((e) => e.id === selected)?.id ?? editors[0]?.id ?? null;

  if (!selectedEditorId) {
    return (
      <div className="mx-auto max-w-[920px]">
        <PageHeader title="Showcase" description="Awards per editor." />
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">Er zijn nog geen editors om te tonen.</p>
      </div>
    );
  }

  const data = await getShowcase(selectedEditorId);
  return (
    <div className="mx-auto max-w-[920px]">
      <PageHeader title="Showcase" description="Awards per editor." />
      <ShowcaseView data={data} ownView={false} editors={editors} selectedEditorId={selectedEditorId} />
    </div>
  );
}
