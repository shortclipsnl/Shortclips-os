import type { Metadata } from "next";
import { requireFinanceOwner } from "@/server/auth/finance-guard";
import { FinanceUpload } from "@/components/finance/finance-upload";
import { getKostenData } from "@/server/kosten/load";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDateFull } from "@/lib/format";
import { KostenDashboard } from "./kosten-dashboard";

export const metadata: Metadata = { title: "Kosten" };
export const dynamic = "force-dynamic";
// Ruim genoeg voor het verwerken van een jaar aan exports via de knop "Exports toevoegen".
export const maxDuration = 300;

/** Ouder dan 7 dagen = niet meer als actueel presenteren. */
function isVerouderd(datum: string | null): boolean {
  return !!datum && Date.now() - new Date(datum).getTime() > 7 * 86_400_000;
}

export default async function KostenPage() {
  // Uitsluitend voor de eigenaar — hard afgedwongen op paginaniveau
  // (defense-in-depth), náást de finance:read-check in getKostenData.
  await requireFinanceOwner();
  const data = await getKostenData();
  const heeftData = Object.keys(data.m).length > 0;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Kostenmonitor"
        description="Alle afschrijvingen van de zakelijke rekening per categorie en leverancier, uitsluitend voor de eigenaar. Bron: Knab-transacties en zakelijke Revolut-abonnementen."
        actions={<FinanceUpload />}
      />
      {heeftData && isVerouderd(data.bijgewerkt) ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 p-3 text-sm">
          Let op: deze kosten zijn voor het laatst bijgewerkt op {formatDateFull(data.bijgewerkt)}. De meest recente maand is daardoor niet compleet.{" "}
          <Link href="/financien/maand" className="font-semibold underline">Bekijk wat ontbreekt en de losse transacties</Link>.
        </div>
      ) : null}
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
