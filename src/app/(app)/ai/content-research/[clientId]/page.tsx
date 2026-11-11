import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { getClientContentResearch } from "@/server/content-research/service";
import { ClientLogo, EmptyState, InfoNote, PageHeader } from "@/components/ui";
import { ClientTabs, type TabDef } from "@/app/(app)/clients/[slug]/tabs";
import { StartResearchButton } from "../start-research-button";
import { IdeaCard, type IdeaView } from "../idea-card";
import { StrategicAdvice, type AdviceItem } from "../strategic-advice";
import { ResearchPanel, type RunView } from "../research-panel";
import { DnaForm } from "../dna-form";
import { ContentChat } from "../content-chat";

export const metadata: Metadata = { title: "AI Content Research" };
export const dynamic = "force-dynamic";
// Een onderzoek kan 1–2 minuten web-onderzoek + ideeën kosten; ruim de tijd geven.
export const maxDuration = 300;

const ACTIVE_IDEA = new Set(["nieuw", "favoriet", "opgeslagen", "doorgestuurd"]);

export default async function ContentResearchClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ tab?: string; seed?: string }>;
}) {
  const viewer = await requirePermission("content_research:read");
  const { clientId } = await params;
  const { tab, seed } = await searchParams;
  const data = await getClientContentResearch(viewer, clientId);
  if (!data) notFound();

  const aiReady = aiConfigured();
  const ideas: IdeaView[] = data.ideas.map((i) => ({
    id: i.id,
    clientId: i.clientId,
    titel: i.titel,
    concept: i.concept,
    hooks: Array.isArray(i.hooks) ? (i.hooks as string[]) : [],
    waaromWerkt: i.waaromWerkt,
    doel: i.doel,
    inspiratieUrl: i.inspiratieUrl,
    inspiratieLabel: i.inspiratieLabel,
    categorie: i.categorie,
    uitvoerbaarheid: i.uitvoerbaarheid,
    score: i.score,
    scoreReason: i.scoreReason,
    status: i.status,
    rejectionReason: i.rejectionReason,
  }));
  const activeIdeas = ideas.filter((i) => ACTIVE_IDEA.has(i.status));
  const archivedIdeas = ideas.filter((i) => !ACTIVE_IDEA.has(i.status));

  const runs: RunView[] = data.runs.map((r) => ({
    id: r.id,
    status: r.status,
    phase: r.phase,
    summary: r.summary,
    trends: Array.isArray(r.trends) ? (r.trends as string[]) : [],
    sources: Array.isArray(r.sources) ? (r.sources as { label: string; url: string }[]) : [],
    ideasCount: r.ideasCount,
    newCount: r.newCount,
    errorMessage: r.errorMessage,
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
  const running = runs.some((r) => r.status === "bezig");

  // Strategisch advies uit de meest recente afgeronde ronde (op basis van resultaten).
  const latestDone = data.runs.find((r) => r.status === "klaar");
  const advies: AdviceItem[] = Array.isArray(latestDone?.strategicAdvice)
    ? (latestDone!.strategicAdvice as AdviceItem[])
    : [];

  const current = tab ?? "ideeen";
  const tabs: TabDef[] = [
    { key: "ideeen", label: "Ideeën", count: activeIdeas.length },
    { key: "onderzoek", label: "Onderzoek", count: runs.length },
    { key: "dna", label: "Content DNA" },
    { key: "chat", label: "Spar met AI" },
  ];

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        breadcrumb={
          <Link href="/ai/content-research" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← AI Content Research</Link>
        }
        title={
          <span className="flex items-center gap-2">
            <ClientLogo name={data.client.name} logoUrl={data.client.logoUrl} size={28} />
            {data.client.name}
          </span>
        }
        actions={<StartResearchButton clientId={clientId} running={running} variant="primary" label="Onderzoek opnieuw" />}
      />

      {!aiReady ? <div className="mb-5"><InfoNote>De AI staat uit (ANTHROPIC_API_KEY ontbreekt).</InfoNote></div> : null}

      <ClientTabs tabs={tabs} />

      {current === "ideeen" ? <StrategicAdvice items={advies} /> : null}

      {current === "ideeen" ? (
        activeIdeas.length === 0 ? (
          <EmptyState
            title={running ? "Onderzoek loopt…" : "Nog geen ideeën"}
            description={running ? "De eerste ideeën verschijnen zodra het onderzoek klaar is." : "Start een onderzoek om originele video-ideeën te krijgen."}
          />
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-[var(--color-ink-faint)]">De AI-score is een interne kwaliteitsinschatting (relevantie, originaliteit, uitvoerbaarheid) — geen voorspelling van weergaven.</p>
            <div className="grid gap-4 md:grid-cols-2">
              {activeIdeas.map((idea) => <IdeaCard key={idea.id} idea={idea} />)}
            </div>
            {archivedIdeas.length > 0 ? (
              <details className="pt-2">
                <summary className="cursor-pointer text-sm text-[var(--color-ink-muted)]">Gearchiveerd / afgewezen ({archivedIdeas.length})</summary>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {archivedIdeas.map((idea) => <IdeaCard key={idea.id} idea={idea} />)}
                </div>
              </details>
            ) : null}
          </div>
        )
      ) : null}

      {current === "onderzoek" ? <ResearchPanel clientId={clientId} runs={runs} /> : null}

      {current === "dna" ? <DnaForm clientId={clientId} dna={data.dna} manualNotes={data.manualNotes} /> : null}

      {current === "chat" ? (
        <ContentChat clientId={clientId} conversations={data.conversations.map((c) => ({ id: c.id, title: c.title }))} aiReady={aiReady} seed={seed} />
      ) : null}
    </div>
  );
}
