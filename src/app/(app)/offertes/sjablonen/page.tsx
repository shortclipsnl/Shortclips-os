import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { listQuoteTemplates } from "@/server/quotes";
import { PageHeader } from "@/components/ui";
import { TemplatesUI } from "./templates-ui";

export const metadata: Metadata = { title: "Offertesjablonen" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await requireOwner();
  const templates = await listQuoteTemplates(true);
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Offertesjablonen"
        breadcrumb={<Link href="/offertes" className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><ChevronLeft className="size-3.5" /> Terug naar offertes</Link>}
        description="Vaste sjablonen voor je offertes. Pas de teksten en standaardregels aan; wijzigingen gelden alleen voor nieuwe offertes — al verzonden offertes blijven ongewijzigd."
      />
      <TemplatesUI templates={templates.map((t) => ({ id: t.id, name: t.name, description: t.description, isArchived: t.isArchived, updatedAt: t.updatedAt }))} />
    </div>
  );
}
