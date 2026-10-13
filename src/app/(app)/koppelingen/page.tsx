import type { Metadata } from "next";
import { requireOwner } from "@/server/auth/context";
import { listLinkSuggestions } from "@/server/link-review";
import { PageHeader, Stat } from "@/components/ui";
import { LinkReview } from "./koppelingen-ui";

export const metadata: Metadata = { title: "Koppelingen" };
export const dynamic = "force-dynamic";

export default async function KoppelingenPage() {
  await requireOwner();
  const { rows, summary } = await listLinkSuggestions();

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Koppelingen controleren"
        description="Video's aan de juiste opnamedag koppelen. Het systeem stelt een opname voor met een betrouwbaarheidsscore; bevestig of wijs af. Na bevestiging wordt de klantdeadline automatisch op 14 werkdagen na de opname gezet."
      />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Gekoppeld" value={String(summary.linked ?? 0)} tone="good" />
        <Stat label="Open suggesties" value={String(summary.open ?? 0)} hint="wachten op controle" />
        <Stat label="Totaal video's" value={String(summary.total ?? 0)} />
      </div>

      <LinkReview rows={rows} />
    </div>
  );
}
