import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { listResearch, type ResearchResult } from "@/server/actions/sales-research";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { ResearchForm } from "./research-form";

export const metadata: Metadata = { title: "Bedrijfsonderzoek" };
export const dynamic = "force-dynamic";

export default async function BedrijfsonderzoekPage() {
  await requirePermission("ai:read");
  const recent = await listResearch();

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Bedrijfsonderzoek"
        description="Onderzoek een (potentiële) klant en maak een salespresentatie. Op basis van echt web-onderzoek — geen verzonnen cijfers."
      />

      <ResearchForm aiReady={aiConfigured()} />

      <div className="mt-6">
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Eerder onderzochte bedrijven" />
          </div>
          {recent.length === 0 ? (
            <EmptyState title="Nog geen onderzoeken" description="Start hierboven je eerste bedrijfsonderzoek." />
          ) : (
            <Table
              head={
                <>
                  <th className="sc-th">Bedrijf</th>
                  <th className="sc-th">Status</th>
                  <th className="sc-th">Belangrijkste kans</th>
                  <th className="sc-th">Laatst gewijzigd</th>
                </>
              }
            >
              {recent.map((r) => {
                const result = (r.result ?? {}) as ResearchResult;
                const kans = result.kansenVoorShortclips?.aanbevolenOplossing ?? result.pijnpunten?.[0]?.observatie ?? "—";
                return (
                  <tr key={r.id} className="sc-row-link">
                    <td className="sc-td">
                      <Link href={`/ai/bedrijfsonderzoek/${r.id}`} className="font-medium hover:underline">
                        {r.companyName}
                      </Link>
                    </td>
                    <td className="sc-td">
                      <Badge tone={r.status === "klaar" ? "good" : "neutral"}>{r.status === "klaar" ? "Klaar" : "Concept"}</Badge>
                    </td>
                    <td className="sc-td max-w-[320px] truncate text-[var(--color-ink-muted)]">{kans}</td>
                    <td className="sc-td text-[var(--color-ink-muted)]">{formatDate(r.updatedAt.toISOString().slice(0, 10))}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
