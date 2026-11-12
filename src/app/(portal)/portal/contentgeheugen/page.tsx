import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PORTAL_CONTENTGEHEUGEN_LIVE } from "@/lib/feature-flags";
import { requirePortal } from "@/server/auth/context";
import { getContentMemory } from "@/server/content-memory";
import { ClientMemoryView } from "@/components/content-memory/client-view";

export const metadata: Metadata = { title: "Contentgeheugen" };
export const dynamic = "force-dynamic";

export default async function PortalContentMemoryPage() {
  const viewer = await requirePortal();
  if (!PORTAL_CONTENTGEHEUGEN_LIVE) redirect("/portal");
  const cm = await getContentMemory(viewer, viewer.clientId!);
  if (!cm) return <p className="text-sm text-[var(--color-ink-muted)]">Nog geen gegevens beschikbaar.</p>;
  return <ClientMemoryView cm={cm} />;
}
