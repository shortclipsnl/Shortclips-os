import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { listResearch, type ResearchResult } from "@/server/actions/sales-research";
import { RESEARCH_STATUS_LABEL } from "@/lib/sales-research";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { ResearchForm } from "./research-form";

export const metadata: Metadata = { title: "AI Sales Research" };
export const dynamic = "force-dynamic";

function statusTone(s: string): "good" | "warn" | "info" | "neutral" {
  if (s === "klant_geworden") return "good";
  if (s === "gepresenteerd" || s === "presentatie_gereed") return "info";
  if (s === "onderzoek_bezig") return "warn";
  if (s === "onderzoek_afgerond" || s === "klaar") return "good";
  return "neutral";
}

export default async function SalesResearchPage() {
  await requirePermission("ai:read");
  const recent = await listResearch();

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Sales Research"
        description="Ontdek de kansen van potentiële klanten en genereer binnen enkele minuten een persoonlijke salespresentatie. Op basis van echt web-onderzoek — geen verzonnen cijfers."
      />

      <ResearchForm aiReady={aiConfigured()} />

      <div className="mt-6">
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Eerdere onderzoeken" subtitle="Alle uitgevoerde sales-onderzoeken met hun status." />
          </div>
          {recent.length === 0 ? (
            <EmptyState title="Nog geen onderzoeken" description="Start hierboven je eerste bedrijfsonderzoek." />
          ) : (
            <Table
              head={
                <>
                  <th className="sc-th">Bedrijf</th>
                  <th className="sc-th">Contactpersoon</th>
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
                      {r.city ? <span className="block text-2xs text-[var(--color-ink-faint)]">{r.city}</span> : null}
                    </td>
                    <td className="sc-td text-[var(--color-ink-muted)]">{r.contactName || "—"}{r.meetingDate ? <span className="block text-2xs text-[var(--color-ink-faint)]">{r.meetingDate}</span> : null}</td>
                    <td className="sc-td">
                      <Badge tone={statusTone(r.status)}>{RESEARCH_STATUS_LABEL[r.status] ?? r.status}</Badge>
                    </td>
                    <td className="sc-td max-w-[300px] truncate text-[var(--color-ink-muted)]">{kans}</td>
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
