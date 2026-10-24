import type { Metadata } from "next";
import { requirePortal } from "@/server/auth/context";
import { getPortalResults } from "@/server/portal";
import { PortalResultsView } from "./results-view";

export const metadata: Metadata = { title: "Resultaten" };
export const dynamic = "force-dynamic";

export default async function PortalResultatenPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const viewer = await requirePortal();
  const { periode } = await searchParams;
  const days = periode === "90" ? 90 : 30;
  const r = await getPortalResults(viewer, days);

  return <PortalResultsView r={r} days={days} hrefForDays={(d) => `/portal/resultaten?periode=${d}`} />;
}
