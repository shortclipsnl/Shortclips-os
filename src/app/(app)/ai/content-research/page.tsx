import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { listContentResearchOverview } from "@/server/content-research/service";
import { Badge, Card, ClientLogo, EmptyState, InfoNote, LinkButton, PageHeader } from "@/components/ui";
import { StartResearchButton } from "./start-research-button";

export const metadata: Metadata = { title: "AI Content Research" };
export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "nog niet onderzocht";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

export default async function ContentResearchOverviewPage() {
  const viewer = await requirePermission("content_research:read");
  const clients = await listContentResearchOverview(viewer);
  const canWrite = viewer.permissions.has("content_research:write");
  const aiReady = aiConfigured();

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Content Research"
        description="Per klant continu, écht onderzoek naar trends en concurrenten, vertaald naar originele organische video-ideeën. Los van Video Intelligence (dat gepubliceerde video's analyseert)."
      />

      {!aiReady ? (
        <div className="mb-5">
          <InfoNote>De AI staat uit (ANTHROPIC_API_KEY ontbreekt). Onderzoek starten kan pas zodra de sleutel is ingesteld.</InfoNote>
        </div>
      ) : null}

      {clients.length === 0 ? (
        <EmptyState title="Geen actieve klanten" description="Zodra er actieve klanten zijn, verschijnen ze hier met hun eigen ideeënomgeving." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--color-ink)]">{c.name}</p>
                  <p className="text-2xs text-[var(--color-ink-faint)]">Laatste onderzoek: {fmtDate(c.lastResearchAt)}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm">
                <span className="tabular-nums"><span className="font-semibold text-[var(--color-ink)]">{c.totalIdeas}</span> <span className="text-[var(--color-ink-muted)]">ideeën</span></span>
                {c.newIdeas > 0 ? <Badge tone="info">{c.newIdeas} nieuw</Badge> : null}
                {c.running ? <Badge tone="info">Onderzoek bezig…</Badge> : null}
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <LinkButton href={`/ai/content-research/${c.id}?tab=ideeen`} variant="secondary" size="sm">Bekijk ideeën</LinkButton>
                {canWrite ? <StartResearchButton clientId={c.id} running={c.running} variant="ghost" /> : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
