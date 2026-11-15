import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PORTAL_CONTENTGEHEUGEN_LIVE } from "@/lib/feature-flags";
import { requirePortal } from "@/server/auth/context";
import { getContentMemory } from "@/server/content-memory";
import { getClientInsights } from "@/server/content-memory/client-insights-store";
import { ClientMemoryView } from "@/components/content-memory/client-view";

export const metadata: Metadata = { title: "Contentgeheugen" };
export const dynamic = "force-dynamic";

export default async function PortalContentMemoryPage() {
  const viewer = await requirePortal();
  if (!PORTAL_CONTENTGEHEUGEN_LIVE) redirect("/portal");
  const cm = await getContentMemory(viewer, viewer.clientId!);
  if (!cm) return <p className="text-sm text-[var(--color-ink-muted)]">Nog geen gegevens beschikbaar.</p>;
  // Alleen inzichten die het team heeft goedgekeurd; zonder goedkeuring blijft de pagina zoals hij was.
  const insights = await getClientInsights(viewer, cm);
  return <ClientMemoryView cm={cm} insights={insights} />;
}
