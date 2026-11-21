import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireLeadsAccess } from "@/server/auth/context";
import { getJourneyView } from "@/server/lead-journey";
import { PageHeader } from "@/components/ui";
import { JourneyBoard } from "./journey-ui";

export const metadata: Metadata = { title: "Leadreis" };
export const dynamic = "force-dynamic";

export default async function LeadJourneyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireLeadsAccess();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const view = await getJourneyView(id);
  if (!view) notFound();

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href="/leads" className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:underline">
        <ArrowLeft className="size-3.5" /> Alle leads
      </Link>
      <PageHeader
        title={view.company}
        description={[view.contactName, view.email, view.phone].filter(Boolean).join(" · ") || "Leadreis van aanvraag tot lopende productie."}
      />
      <JourneyBoard view={view} />
    </div>
  );
}
