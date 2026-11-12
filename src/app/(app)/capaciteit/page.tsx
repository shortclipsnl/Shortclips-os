import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireInternal, isOwner } from "@/server/auth/context";
import { loadRadarData } from "@/server/capacity-radar";
import { RadarView } from "./radar-view";

export const metadata: Metadata = { title: "Capaciteit" };
export const dynamic = "force-dynamic";

/**
 * Productie › Capaciteit: wie zit vol, wie heeft ruimte en welke opnames komen
 * eraan. Volledig automatisch berekend uit de opnameplanning (Google Agenda),
 * de Editingpagina en de capaciteit per persoon. Alleen lezen; wijzigen gaat
 * via de opname of de Editingpagina. De eigenaar kan capaciteit en grenzen
 * instellen.
 */
export default async function CapacityPage() {
  const viewer = await requireInternal();
  if (viewer.isEditorOnly) redirect("/dashboard");
  const data = await loadRadarData();
  return <RadarView data={data} canEdit={isOwner(viewer)} />;
}
