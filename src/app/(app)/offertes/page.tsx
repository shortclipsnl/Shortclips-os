import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature, LayoutTemplate, Plus, Settings } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { getQuotesOverview } from "@/server/quotes";
import { PageHeader } from "@/components/ui";
import { OffertesBoard } from "./offertes-board";

export const metadata: Metadata = { title: "Offertes" };
export const dynamic = "force-dynamic";

export default async function OffertesPage() {
  await requireOwner();
  const { rows, stats } = await getQuotesOverview();

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Offertes"
        description="Maak, deel en volg offertes vanuit één plek. Kies een sjabloon, pas de klantgegevens aan, genereer een beveiligde link en zie wanneer de klant 'm opent."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/offertes/sjablonen" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
              <LayoutTemplate className="size-4" /> Sjablonen
            </Link>
            <Link href="/offertes/instellingen" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
              <Settings className="size-4" /> Bedrijfsgegevens
            </Link>
            <Link href="/offertes/nieuw" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
              <Plus className="size-4" /> Nieuwe offerte
            </Link>
          </div>
        }
      />

      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] px-6 py-16 text-center">
          <FileSignature className="mx-auto mb-3 size-8 text-[var(--color-ink-faint)]" />
          <p className="text-sm font-semibold text-[var(--color-ink)]">Nog geen offertes</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">Maak een sjabloon aan en stel je eerste offerte samen. Je kunt 'm daarna delen via een beveiligde link en volgen of de klant 'm opent.</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Link href="/offertes/sjablonen" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]"><LayoutTemplate className="size-4" /> Sjablonen</Link>
            <Link href="/offertes/nieuw" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"><Plus className="size-4" /> Nieuwe offerte</Link>
          </div>
        </div>
      ) : (
        <OffertesBoard rows={rows} stats={stats} />
      )}
    </div>
  );
}
