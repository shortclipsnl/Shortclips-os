import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { amsterdamToday, parsePeriodKey, resolvePeriod } from "@/lib/resultaten-overzicht";
import { loadPresentation } from "@/server/resultaten-presentatie";
import { PresentationDeck } from "./deck";

export const metadata: Metadata = { title: "Presentatiemodus · Resultaten" };
export const dynamic = "force-dynamic";

/**
 * Presentatiemodus van de resultatenpagina: schermvullende slides voor een
 * groot scherm of tv, met dezelfde cijfers als /analytics.
 */
export default async function ResultsPresentationPage({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  await requirePermission("analytics:read");
  const { periode } = await searchParams;
  const period = resolvePeriod(parsePeriodKey(periode), amsterdamToday());
  const data = await loadPresentation(period);
  return <PresentationDeck initial={data} />;
}
