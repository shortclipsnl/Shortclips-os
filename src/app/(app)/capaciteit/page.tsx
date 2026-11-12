import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal, isOwner } from "@/server/auth/context";
import { loadCapacityData } from "@/server/capacity-forecast";
import { ErrorNote } from "@/components/ui";
import { CapacityDashboard } from "./capacity-dashboard";

export const metadata: Metadata = { title: "Capaciteit" };
export const dynamic = "force-dynamic";

/**
 * Productie › Capaciteit: capaciteitsradar voor videografie en editing.
 * Leest uitsluitend bestaande data (opnames uit Google Agenda, editingfases,
 * klantpakketten, verlof en de capaciteitsgrenzen per persoon) en wijzigt niets.
 * De grenzen per persoon stel je in op /capaciteit/team (alleen eigenaar).
 */
export default async function CapacityPage() {
  const viewer = await requireInternal();
  // Editors zien de radar van het hele team niet.
  if (viewer.isEditorOnly) notFound();
  let data: Awaited<ReturnType<typeof loadCapacityData>> | null = null;
  try {
    data = await loadCapacityData();
  } catch (error) {
    console.error("[capaciteit] laden mislukt", error);
  }
  return (
    <div className="mx-auto max-w-[1240px]">
      {data ? (
        <CapacityDashboard data={data} canEdit={isOwner(viewer)} />
      ) : (
        <ErrorNote>De capaciteitsradar kon niet geladen worden. Probeer het over een minuut opnieuw.</ErrorNote>
      )}
    </div>
  );
}
