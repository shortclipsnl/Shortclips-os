import type { Metadata } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePortal } from "@/server/auth/context";
import { getPortalResults } from "@/server/portal";
import { parsePortalPeriod } from "@/lib/portal-periods";
import { ResultReport } from "@/components/portal/result-report";

export const metadata: Metadata = { title: "Resultatenrapport" };
export const dynamic = "force-dynamic";

/** Printbaar resultatenrapport voor de ingelogde klant (eigen cijfers). */
export default async function ResultatenRapportPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; van?: string; tot?: string }>;
}) {
  const viewer = await requirePortal();
  const period = parsePortalPeriod(await searchParams);
  const [r, [client]] = await Promise.all([
    getPortalResults(viewer, { days: period.days, from: period.from, to: period.to, periodKey: period.key }),
    db.select({ name: clients.name, logoUrl: clients.logoUrl }).from(clients).where(and(eq(clients.id, viewer.clientId ?? ""), isNull(clients.deletedAt))).limit(1),
  ]);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f8" }}>
      <ResultReport r={r} clientName={client?.name ?? "Klant"} clientLogoUrl={client?.logoUrl ?? null} />
    </div>
  );
}
