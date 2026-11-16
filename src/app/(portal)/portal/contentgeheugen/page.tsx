import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PORTAL_CONTENTGEHEUGEN_LIVE } from "@/lib/feature-flags";
import { requirePortal } from "@/server/auth/context";
import { ClientYearMemoryPage } from "@/components/content-memory/client-year-page";

export const metadata: Metadata = { title: "Contentgeheugen" };
export const dynamic = "force-dynamic";

export default async function PortalContentMemoryPage() {
  const viewer = await requirePortal();
  if (!PORTAL_CONTENTGEHEUGEN_LIVE) redirect("/portal");
  // Alleen de eigen klant: het klant-id komt uit de sessie, nooit uit de URL.
  return <ClientYearMemoryPage viewer={viewer} clientId={viewer.clientId!} />;
}
