import type { Metadata } from "next";
import { requireInternal } from "@/server/auth/context";
import { getQualityOverview } from "@/server/quality";
import { PageHeader } from "@/components/ui";
import { KwaliteitBoard } from "./kwaliteit-board";

export const metadata: Metadata = { title: "Kwaliteit & Aandachtspunten" };
export const dynamic = "force-dynamic";

/**
 * Automatisch gesignaleerde aandachtspunten, per ernst gegroepeerd. De drie
 * groepen — Directe actie (rood), Extra aandacht (oranje) en Vooruit kijken
 * (blauw) — staan als knoppen naast elkaar; klik een knop om de punten van die
 * ernst te zien. Zo blijft het overzichtelijk en snel te scannen.
 */
export default async function QualityPage() {
  const viewer = await requireInternal();
  const { items, counts } = await getQualityOverview(viewer);

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Kwaliteit & Aandachtspunten"
        description="Waar het team op stuurt, ingedeeld per actiegebied: zijn de scripts op tijd, loopt de editing achter, moet er iets naar de klant, en welke plekken in de agenda moeten nog gevuld worden. De kleur toont de ernst — rood = directe actie, oranje = extra aandacht, blauw = vooruitkijken."
      />
      <KwaliteitBoard items={items} counts={counts} />
    </div>
  );
}
