import type { Metadata } from "next";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { aiOutputs, clients, salesResearch } from "@/db/schema";
import { requirePermission, scopeToClients } from "@/server/auth/context";
import { InfoNote, PageHeader } from "@/components/ui";
import { HistoryList, type HistoryRow } from "./history-list";

export const metadata: Metadata = { title: "AI-geschiedenis" };
export const dynamic = "force-dynamic";

const TOOL_LABEL: Record<string, string> = { caption: "Caption", briefing: "Briefing", message: "Klantbericht" };
const TOOL_HREF: Record<string, string> = { caption: "/ai/caption", briefing: "/ai/briefing", message: "/ai/bericht" };

export default async function GeschiedenisPage() {
  const viewer = await requirePermission("ai:read");

  const [outputs, research] = await Promise.all([
    db
      .select({ id: aiOutputs.id, tool: aiOutputs.tool, title: aiOutputs.title, createdAt: aiOutputs.createdAt, clientName: clients.name })
      .from(aiOutputs)
      .innerJoin(clients, eq(clients.id, aiOutputs.clientId))
      .where(and(isNull(aiOutputs.deletedAt), scopeToClients(viewer, aiOutputs.clientId)))
      .orderBy(desc(aiOutputs.createdAt))
      .limit(200),
    db
      .select({ id: salesResearch.id, companyName: salesResearch.companyName, createdAt: salesResearch.createdAt })
      .from(salesResearch)
      .where(isNull(salesResearch.deletedAt))
      .orderBy(desc(salesResearch.createdAt))
      .limit(100),
  ]);

  const rows: HistoryRow[] = [
    ...outputs.map((o) => ({
      id: o.id,
      tool: o.tool,
      toolLabel: TOOL_LABEL[o.tool] ?? o.tool,
      title: o.title ?? "Zonder titel",
      clientName: o.clientName,
      createdAt: o.createdAt.toISOString(),
      href: TOOL_HREF[o.tool] ?? "/ai/caption",
    })),
    ...research.map((r) => ({
      id: r.id,
      tool: "research",
      toolLabel: "Bedrijfsonderzoek",
      title: r.companyName,
      clientName: r.companyName,
      createdAt: r.createdAt.toISOString(),
      href: `/ai/bedrijfsonderzoek/${r.id}`,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader title="AI-geschiedenis" description="Alle gegenereerde captions, briefings, klantberichten en bedrijfsonderzoeken op één plek — terug te vinden en opnieuw te openen." />
      <div className="mb-4">
        <InfoNote>Alles wat de AI Tools maken wordt automatisch opgeslagen in het dashboard (database), per klant. Niets gaat verloren als je een scherm sluit.</InfoNote>
      </div>
      <HistoryList rows={rows} />
    </div>
  );
}
