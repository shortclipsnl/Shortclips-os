import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { salesResearch } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import type { ResearchResult, Source } from "@/server/actions/sales-research";
import { listClientsForScripts } from "@/server/ai/knowledge";
import { LinkButton, PageHeader } from "@/components/ui";
import { Download } from "lucide-react";
import { ResearchEditor } from "./research-editor";
import { RerunButton } from "./rerun";
import { StatusBar } from "./status-bar";

export const metadata: Metadata = { title: "AI Sales Research" };
export const dynamic = "force-dynamic";

export default async function ResearchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("ai:read");

  const [row] = await db.select().from(salesResearch).where(and(eq(salesResearch.id, id), isNull(salesResearch.deletedAt))).limit(1);
  if (!row) notFound();

  const result = (row.result ?? {}) as ResearchResult;
  const sources = (row.sources ?? []) as Source[];
  const versions = (Array.isArray(row.resultVersions) ? row.resultVersions : []) as Array<{ at: string }>;
  const done = row.status !== "concept" && row.status !== "onderzoek_bezig";
  const clients = (await listClientsForScripts(viewer)).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto max-w-[900px]">
      <Link href="/ai/bedrijfsonderzoek" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← AI Sales Research</Link>
      <PageHeader
        title={row.companyName}
        description={[row.city, row.branche, row.contactName ? `contact: ${row.contactName}` : null].filter(Boolean).join(" · ") || "Sales-analyse"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RerunButton id={id} label={done ? "Opnieuw onderzoeken" : "Start onderzoek"} />
            {done ? <LinkButton href={`/presentatie/${id}`} size="sm">Presentatie openen</LinkButton> : null}
            {done ? (
              <a href={`/api/sales-research/${id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">
                <Download className="size-4" /> Download PDF
              </a>
            ) : null}
          </div>
        }
      />

      <div className="mb-4">
        <StatusBar id={id} status={row.status} clientId={row.clientId} clients={clients} />
      </div>

      <ResearchEditor id={id} initial={result} sources={sources} versions={versions} />
    </div>
  );
}
