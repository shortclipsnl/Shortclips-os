import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { getClientContentResearch, listContentResearchOverview } from "@/server/content-research/service";
import { EmptyState, InfoNote, PageHeader } from "@/components/ui";
import { ClientTabs, type TabDef } from "@/app/(app)/clients/[slug]/tabs";
import { StartResearchButton } from "../start-research-button";
import { ClientBand, IdeaRow, type IdeaView } from "../idea-card";
import { ClientLogoStrip } from "../client-logo-strip";
import { toIdeaView } from "@/server/content-research/idea-view";
import { CompetitorsPanel } from "../competitors-panel";
import { IdeaFilter } from "../idea-filter";
import { rankWithVariety } from "@/server/content-research/opportunity";
import { StrategicAdvice, type AdviceItem } from "../strategic-advice";
import { ResearchPanel, type RunView } from "../research-panel";
import { DnaForm } from "../dna-form";
import { StylePanel } from "../style-panel";
import { ContentChat } from "../content-chat";

export const metadata: Metadata = { title: "AI Content Research" };
export const dynamic = "force-dynamic";
// Een onderzoek kan 1–2 minuten web-onderzoek + ideeën kosten; ruim de tijd geven.
export const maxDuration = 300;

const ACTIVE_IDEA = new Set(["nieuw", "favoriet", "opgeslagen", "doorgestuurd"]);
const FILTERS: Record<string, (s: string) => boolean> = {
  open: (s) => s === "nieuw",
  interessant: (s) => s === "favoriet",
  later: (s) => s === "opgeslagen",
  doorgestuurd: (s) => s === "doorgestuurd",
  archief: (s) => !ACTIVE_IDEA.has(s),
};

/** De keuringsuitslag van een ronde (alle kandidaten, ook de afgewezen). */
function candidatesView(raw: unknown): RunView["keuring"] {
  const k = raw as { beoordeeld?: Array<{ titel: string; keuring?: { totaal?: number; onderdelen?: { stijlFit?: { score?: number } }; oordeel?: string }; getoond: boolean; reden: string | null }> } | null;
  if (!k?.beoordeeld) return null;
  return k.beoordeeld.map((b) => ({
    titel: b.titel,
    totaal: b.keuring?.totaal ?? 0,
    stijlFit: b.keuring?.onderdelen?.stijlFit?.score ?? null,
    oordeel: b.keuring?.oordeel ?? "",
    getoond: b.getoond,
    reden: b.reden,
  }));
}

export default async function ContentResearchClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ tab?: string; seed?: string; filter?: string }>;
}) {
  const viewer = await requirePermission("content_research:read");
  const { clientId } = await params;
  const { tab, seed, filter } = await searchParams;
  const [data, overview] = await Promise.all([getClientContentResearch(viewer, clientId), listContentResearchOverview(viewer)]);
  if (!data) notFound();

  const aiReady = aiConfigured();
  const ideas: IdeaView[] = data.ideas.map(toIdeaView);
  const activeIdeas = ideas.filter((i) => ACTIVE_IDEA.has(i.status));
  const currentFilter = filter && FILTERS[filter] ? filter : "alle";
  const filtered = currentFilter === "alle" ? activeIdeas : ideas.filter((i) => FILTERS[currentFilter]!(i.status));
  // Beste ideeën bovenaan, maar met variatie in categorie.
  const shownIdeas = rankWithVariety(filtered);
  const counts = {
    alle: activeIdeas.length,
    open: ideas.filter((i) => FILTERS.open!(i.status)).length,
    interessant: ideas.filter((i) => FILTERS.interessant!(i.status)).length,
    later: ideas.filter((i) => FILTERS.later!(i.status)).length,
    doorgestuurd: ideas.filter((i) => FILTERS.doorgestuurd!(i.status)).length,
    archief: ideas.filter((i) => FILTERS.archief!(i.status)).length,
  };

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
    dataBasis: (r.dataBasis ?? {}) as RunView["dataBasis"],
    keuring: candidatesView(r.kandidaten),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
  const running = data.running;

  // Strategisch advies uit de meest recente afgeronde ronde (op basis van resultaten).
  const latestDone = data.runs.find((r) => r.status === "klaar");
  const advies: AdviceItem[] = Array.isArray(latestDone?.strategicAdvice)
    ? (latestDone!.strategicAdvice as AdviceItem[])
    : [];

  const clientLook = { name: data.client.name, logoUrl: data.client.logoUrl, color: data.client.color };
  const current = tab ?? "ideeen";
  const tabs: TabDef[] = [
    { key: "ideeen", label: "Ideeën", count: activeIdeas.length },
    { key: "concurrenten", label: "Concurrenten", count: data.competitors.filter((c) => c.actief).length },
    { key: "onderzoek", label: "Onderzoek & historie", count: runs.length },
    { key: "dna", label: "Stijl & DNA" },
    { key: "chat", label: "Spar met AI" },
  ];

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        breadcrumb={
          <Link href="/ai/content-research" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← AI Content Research</Link>
        }
        title="Content Research"
        actions={<StartResearchButton clientId={clientId} running={running} variant="primary" label="Onderzoek opnieuw" />}
      />

      <ClientLogoStrip activeId={clientId} clients={overview.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, logoUrl: c.logoUrl, color: c.color, newIdeas: c.newIdeas }))} />

      <div className="sc-card mb-4 overflow-hidden"><ClientBand client={clientLook} size="lg" /></div>

      {!aiReady ? <div className="mb-5"><InfoNote>De AI staat uit (ANTHROPIC_API_KEY ontbreekt).</InfoNote></div> : null}

      <ClientTabs tabs={tabs} />

      {/* Strategisch advies staat bij Onderzoek: het ideeëntabblad blijft rustig. */}
      {current === "onderzoek" ? <StrategicAdvice items={advies} /> : null}

      {current === "ideeen" ? (
        <div className="space-y-4">
          <IdeaFilter current={currentFilter} counts={counts} />
          {shownIdeas.length === 0 ? (
            <EmptyState
              title={running ? "Onderzoek loopt" : "Geen ideeën in deze weergave"}
              description={running ? "De ideeën verschijnen zodra het onderzoek klaar is (meestal binnen 10 minuten)." : "Kies een andere weergave of start een nieuw onderzoek."}
            />
          ) : (
            <ol className="sc-card divide-y divide-[var(--color-line)] overflow-hidden">
              {shownIdeas.map((idea, n) => <IdeaRow key={idea.id} idea={idea} n={n + 1} clientName={data.client.name} />)}
            </ol>
          )}
        </div>
      ) : null}

      {current === "concurrenten" ? (
        <CompetitorsPanel
          clientId={clientId}
          canWrite={viewer.permissions.has("content_research:write")}
          competitors={data.competitors.map((c) => ({
            id: c.id,
            naam: c.naam,
            url: c.url,
            tiktok: c.tiktok,
            instagram: c.instagram,
            youtube: c.youtube,
            notitie: c.notitie,
            bron: c.bron,
            actief: c.actief,
            laatsteObservatie: c.laatsteObservatie,
            laatsteObservatieOp: c.laatsteObservatieOp ? c.laatsteObservatieOp.toISOString() : null,
          }))}
        />
      ) : null}

      {current === "onderzoek" ? <ResearchPanel clientId={clientId} runs={runs} /> : null}

      {current === "dna" ? (
        <div className="space-y-4">
          <StylePanel
            clientId={clientId}
            canWrite={viewer.permissions.has("content_research:write")}
            profile={data.style.profile}
            sources={data.style.sources.map((s) => ({ name: s.name, modifiedAt: s.modifiedAt }))}
            updatedAt={data.style.updatedAt ? data.style.updatedAt.toISOString() : null}
            notes={data.style.notes}
          />
          <DnaForm clientId={clientId} dna={data.dna} manualNotes={data.manualNotes} />
        </div>
      ) : null}

      {current === "chat" ? (
        <ContentChat clientId={clientId} conversations={data.conversations.map((c) => ({ id: c.id, title: c.title }))} aiReady={aiReady} seed={seed} />
      ) : null}
    </div>
  );
}
