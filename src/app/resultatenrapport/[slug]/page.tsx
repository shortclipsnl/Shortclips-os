import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { getPortalResultsForClient } from "@/server/portal";
import { parsePortalPeriod } from "@/lib/portal-periods";
import { ResultReport } from "@/components/portal/result-report";

export const metadata: Metadata = { title: "Resultatenrapport" };
export const dynamic = "force-dynamic";

/**
 * Intern beschikbaar resultatenrapport voor een klant (zelfde cijfers als het
 * klantportaal). Hard gescoped op klanttoegang via requirePermission + scope.
 */
export default async function InternResultatenRapportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ periode?: string; van?: string; tot?: string }>;
}) {
  const viewer = await requirePermission("analytics:read");
  const { slug } = await params;
  const period = parsePortalPeriod(await searchParams);

  const [client] = await db
    .select({ id: clients.id, name: clients.name, logoUrl: clients.logoUrl })
    .from(clients)
    .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) notFound();

  const r = await getPortalResultsForClient(viewer, client.id, { days: period.days, from: period.from, to: period.to, periodKey: period.key });

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f8" }}>
      <ResultReport r={r} clientName={client.name} clientLogoUrl={client.logoUrl} />
    </div>
  );
}
