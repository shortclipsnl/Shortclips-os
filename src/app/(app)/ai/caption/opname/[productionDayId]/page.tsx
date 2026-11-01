import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/server/auth/context";
import { getShootCaptions } from "@/server/captions/service";
import { PageHeader } from "@/components/ui";
import { OpnameCaptions } from "./opname-captions-ui";

export const metadata: Metadata = { title: "Captions bij opname" };
export const dynamic = "force-dynamic";
// Hergenereren roept de AI aan (kan tientallen seconden duren).
export const maxDuration = 300;

export default async function OpnameCaptionsPage({
  params,
}: {
  params: Promise<{ productionDayId: string }>;
}) {
  const viewer = await requirePermission("ai:read");
  const { productionDayId } = await params;
  const detail = await getShootCaptions(viewer, productionDayId);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Captions bij opname"
        description={`${detail.clientName} · ${detail.title}`}
        breadcrumb={
          <Link href="/ai/caption" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <ArrowLeft className="size-3.5" /> Terug naar Caption Maker
          </Link>
        }
      />
      <OpnameCaptions detail={detail} />
    </div>
  );
}
