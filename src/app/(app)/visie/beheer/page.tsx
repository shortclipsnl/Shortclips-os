import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireOwner } from "@/server/auth/context";
import { getVisie } from "@/server/visie";
import { VisieBeheer } from "./beheer";

export const metadata: Metadata = { title: "Beheer Onze visie" };
export const dynamic = "force-dynamic";

/** Alleen voor Jarno: de centrale teksten aanpassen, besluiten afvinken en de visie vaststellen. */
export default async function VisieBeheerPage() {
  await requireOwner();
  const visie = await getVisie();
  return (
    <div className="mx-auto max-w-[1100px] pb-16">
      <PageHeader
        breadcrumb={
          <Link href="/visie" className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <ArrowLeft className="size-4" /> Onze visie
          </Link>
        }
        title="Beheer Onze visie"
        description="Dit is de enige bron. Wat je hier wijzigt, verandert direct op Onze visie, Vandaag, Mijn verantwoordelijkheden, Scripting, de editorbriefing, het draaiboek en Teammeetings."
      />
      <VisieBeheer start={visie} />
    </div>
  );
}
