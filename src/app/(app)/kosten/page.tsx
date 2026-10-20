import type { Metadata } from "next";
import { requireOwner } from "@/server/auth/context";
import { getKostenData } from "@/server/kosten/load";
import { EmptyState, PageHeader } from "@/components/ui";
import { KostenDashboard } from "./kosten-dashboard";

export const metadata: Metadata = { title: "Kosten" };
export const dynamic = "force-dynamic";

export default async function KostenPage() {
  // Uitsluitend voor de eigenaar — hard afgedwongen op paginaniveau
  // (defense-in-depth), náást de finance:read-check in getKostenData.
  await requireOwner();
  const data = await getKostenData();
  const heeftData = Object.keys(data.m).length > 0;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Kostenmonitor"
        description="Alle afschrijvingen van de zakelijke rekening per categorie en leverancier — uitsluitend voor de eigenaar. Elke 1e van de maand automatisch uit DigiBoox."
      />
      {heeftData ? (
        <KostenDashboard data={data} />
      ) : (
        <EmptyState
          title="Nog geen kosten"
          description="Na de maandelijkse uitlezing van DigiBoox op de 1e verschijnen hier alle afschrijvingen per categorie en leverancier."
        />
      )}
    </div>
  );
}
