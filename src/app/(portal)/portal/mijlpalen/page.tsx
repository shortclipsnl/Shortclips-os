import type { Metadata } from "next";
import { requirePortal } from "@/server/auth/context";
import { getPortalMilestones } from "@/server/milestones";
import { MijlpalenView } from "./mijlpalen-view";

export const metadata: Metadata = { title: "Onze mijlpalen" };
export const dynamic = "force-dynamic";

/**
 * Onze mijlpalen: de resultaten en awards die de klant samen met Shortclips
 * behaalde. Aanvulling op Resultaten, geen vervanging. Alles wordt automatisch
 * berekend uit de bestaande statistieken en klantgegevens (zie
 * src/server/milestones.ts); de klant ziet uitsluitend zijn eigen cijfers.
 */
export default async function PortalMijlpalenPage() {
  const viewer = await requirePortal();
  const data = await getPortalMilestones(viewer);
  return <MijlpalenView data={data} />;
}
