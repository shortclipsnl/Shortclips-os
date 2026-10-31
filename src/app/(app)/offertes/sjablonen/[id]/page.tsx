import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { getTemplateWithVersion } from "@/server/quotes";
import { PageHeader } from "@/components/ui";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Sjabloon bewerken" };
export const dynamic = "force-dynamic";

export default async function TemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const data = await getTemplateWithVersion(id);
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeader
        title={data.template.name}
        breadcrumb={<Link href="/offertes/sjablonen" className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><ChevronLeft className="size-3.5" /> Terug naar sjablonen</Link>}
        description="Pas de opbouw en teksten aan. Opslaan maakt een nieuwe versie; eerder verzonden offertes behouden hun oorspronkelijke inhoud."
      />
      <TemplateEditor id={id} name={data.template.name} content={data.content} />
    </div>
  );
}
