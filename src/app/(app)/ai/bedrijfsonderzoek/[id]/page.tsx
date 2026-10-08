import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { salesResearch } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import type { ResearchResult, Source } from "@/server/actions/sales-research";
import { Badge, LinkButton, PageHeader } from "@/components/ui";
import { ResearchEditor } from "./research-editor";
import { RerunButton } from "./rerun";

export const metadata: Metadata = { title: "Bedrijfsonderzoek" };
export const dynamic = "force-dynamic";

export default async function ResearchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("ai:read");

  const [row] = await db.select().from(salesResearch).where(and(eq(salesResearch.id, id), isNull(salesResearch.deletedAt))).limit(1);
  if (!row) notFound();

  const result = (row.result ?? {}) as ResearchResult;
  const sources = (row.sources ?? []) as Source[];
  const done = row.status === "klaar";

  return (
    <div className="mx-auto max-w-[900px]">
      <Link href="/ai/bedrijfsonderzoek" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← Bedrijfsonderzoek</Link>
      <PageHeader
        title={row.companyName}
        description="Sales-analyse"
        actions={
          <div className="flex items-center gap-2">
            <RerunButton id={id} label={done ? "Opnieuw onderzoeken" : "Start onderzoek"} />
            {done ? <LinkButton href={`/presentatie/${id}`} size="sm">Presentatie openen</LinkButton> : null}
          </div>
        }
      />

      <div className="mb-4">
        <Badge tone={done ? "good" : "neutral"}>{done ? "Onderzoek afgerond" : "Nog niet onderzocht"}</Badge>
      </div>

      <ResearchEditor id={id} initial={result} sources={sources} />
    </div>
  );
}
