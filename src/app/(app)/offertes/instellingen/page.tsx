import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { getCompanyInfo } from "@/server/quotes/company";
import { signhostConfigured } from "@/server/quotes/signhost";
import { PageHeader } from "@/components/ui";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Bedrijfsgegevens" };
export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  await requireOwner();
  const company = await getCompanyInfo();
  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        title="Bedrijfsgegevens"
        breadcrumb={<Link href="/offertes" className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><ChevronLeft className="size-3.5" /> Terug naar offertes</Link>}
        description="Deze gegevens komen op elke offerte en PDF te staan (kop en voettekst)."
      />
      <CompanyForm company={company} />
      <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-4 text-sm text-[var(--color-ink-muted)]">
        <p className="font-semibold text-[var(--color-ink)]">Ondertekenen (e-handtekening)</p>
        <p className="mt-1">
          Gekwalificeerde e-handtekening via Signhost/Evidos is {signhostConfigured() ? "ingesteld" : "nog niet ingesteld"}.
          {signhostConfigured() ? " Klanten kunnen de offerte rechtsgeldig ondertekenen." : " Zonder koppeling kunnen klanten de offerte wel digitaal accepteren (met bewijsrecord), maar nog niet gekwalificeerd ondertekenen. Zet hiervoor SIGNHOST_API_KEY en SIGNHOST_APP_KEY in de omgeving."}
        </p>
      </div>
    </div>
  );
}
