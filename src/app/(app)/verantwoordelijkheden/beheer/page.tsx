import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireOwner } from "@/server/auth/context";
import { getVerantwoordelijkheden } from "@/server/verantwoordelijkheden";
import { Beheer } from "./beheer";

export const metadata: Metadata = { title: "Beheer verantwoordelijkheden" };
export const dynamic = "force-dynamic";

/** Alleen voor Jarno: verantwoordelijkheden toevoegen, wijzigen, verwijderen en goedkeuren. */
export default async function BeheerPage() {
  await requireOwner();
  const config = await getVerantwoordelijkheden();
  return (
    <div className="mx-auto max-w-[1100px] pb-16">
      <PageHeader
        breadcrumb={
          <Link href="/verantwoordelijkheden" className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <ArrowLeft className="size-4" /> Mijn verantwoordelijkheden
          </Link>
        }
        title="Beheer verantwoordelijkheden"
        description="Pas per medewerker de verantwoordelijkheden, bevoegdheden, escalaties en vervangers aan. Na goedkeuring ziet het team elke wijziging direct."
      />
      <Beheer start={config} />
    </div>
  );
}
