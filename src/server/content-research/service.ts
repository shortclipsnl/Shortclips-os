import "server-only";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  contentChatConversations,
  contentCompetitors,
  contentIdeas,
  contentResearchRuns,
} from "@/db/schema";
import { STALE_MIN } from "./run";
import { rankWithVariety } from "./opportunity";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";
import { listClientsForScripts, clientLearnedText } from "@/server/ai/knowledge";
import { gatherFeedbackContext } from "@/server/script-control";
import { getClientWinningPatterns } from "@/server/scripts/winning-patterns";
import { loadDna, dnaToText, type ContentDna } from "./content-dna";
import { buildPerformanceContext } from "./performance";

export type OverviewClient = {
  id: string;
  name: string;
  logoUrl: string | null;
  color: string | null;
  active: boolean;
  totalIdeas: number;
  newIdeas: number;
  lastResearchAt: string | null;
  running: boolean;
  /** Laatste ronde mislukt (met leesbare reden). */
  lastError: string | null;
  /** Ideeën uit de laatste geslaagde ronde die nog niet beoordeeld zijn. */
  newSinceLast: number;
  /** Hoogste Opportunity Score onder de open ideeën. */
  topScore: number;
};

export type WeeklyIdea = {
  id: string;
  clientId: string;
  clientName: string;
  logoUrl: string | null;
  color: string | null;
  titel: string;
  hook: string | null;
  categorie: string;
  opportunityScore: number;
  createdAt: string;
};

/** Overzicht: alle klanten (met actief-vlag) + hun idee-tellingen en laatste onderzoek. */
export async function listContentResearchOverview(viewer: Viewer): Promise<OverviewClient[]> {
  const clientsList = await listClientsForScripts(viewer);
  if (clientsList.length === 0) return [];
  const ids = new Set(clientsList.map((c) => c.id));

  const scope = scopeToClients(viewer, contentIdeas.clientId);
  const ideas = await db
    .select({ clientId: contentIdeas.clientId, status: contentIdeas.status, runId: contentIdeas.runId, opportunityScore: contentIdeas.opportunityScore })
    .from(contentIdeas)
    .where(and(isNull(contentIdeas.deletedAt), scope ?? undefined));

  const runScope = scopeToClients(viewer, contentResearchRuns.clientId);
  const runs = await db
    .select({
      clientId: contentResearchRuns.clientId,
      id: contentResearchRuns.id,
      status: contentResearchRuns.status,
      finishedAt: contentResearchRuns.finishedAt,
      createdAt: contentResearchRuns.createdAt,
      heartbeatAt: contentResearchRuns.heartbeatAt,
      errorMessage: contentResearchRuns.errorMessage,
    })
    .from(contentResearchRuns)
    .where(and(isNull(contentResearchRuns.deletedAt), runScope ?? undefined))
    .orderBy(desc(contentResearchRuns.createdAt));

  const lastAt = new Map<string, string>();
  const lastOkRun = new Map<string, string>();
  const running = new Set<string>();
  const lastError = new Map<string, string | null>();
  const seenLatest = new Set<string>();
  for (const r of runs) {
    if (!ids.has(r.clientId)) continue;
    // Alleen de meest recente ronde bepaalt "bezig"/"mislukt"; een ronde zonder
    // hartslag in STALE_MIN minuten is geen lopend onderzoek meer.
    if (!seenLatest.has(r.clientId)) {
      seenLatest.add(r.clientId);
      const beat = (r.heartbeatAt ?? r.createdAt).getTime();
      if (r.status === "bezig" && (Date.now() - beat) / 60000 < STALE_MIN) running.add(r.clientId);
      lastError.set(r.clientId, r.status === "mislukt" ? r.errorMessage : null);
    }
    if (r.status === "klaar" && r.finishedAt && !lastAt.has(r.clientId)) {
      lastAt.set(r.clientId, r.finishedAt.toISOString());
      lastOkRun.set(r.clientId, r.id);
    }
  }

  const totals = new Map<string, number>();
  const news = new Map<string, number>();
  const sinceLast = new Map<string, number>();
  const top = new Map<string, number>();
  for (const i of ideas) {
    if (!ids.has(i.clientId) || i.status === "gearchiveerd" || i.status === "afgewezen" || i.status === "gebruikt") continue;
    totals.set(i.clientId, (totals.get(i.clientId) ?? 0) + 1);
    if (i.status === "nieuw") {
      news.set(i.clientId, (news.get(i.clientId) ?? 0) + 1);
      if (i.runId && i.runId === lastOkRun.get(i.clientId)) sinceLast.set(i.clientId, (sinceLast.get(i.clientId) ?? 0) + 1);
      top.set(i.clientId, Math.max(top.get(i.clientId) ?? 0, i.opportunityScore));
    }
  }

  return clientsList.map((c) => ({
    id: c.id,
    name: c.name,
    logoUrl: c.logoUrl,
    color: c.color,
    active: c.active,
    totalIdeas: totals.get(c.id) ?? 0,
    newIdeas: news.get(c.id) ?? 0,
    lastResearchAt: lastAt.get(c.id) ?? null,
    running: running.has(c.id),
    lastError: lastError.get(c.id) ?? null,
    newSinceLast: sinceLast.get(c.id) ?? 0,
    topScore: top.get(c.id) ?? 0,
  }));
}

/**
 * Het weekoverzicht: de sterkste open ideeën van de afgelopen 8 dagen over alle
 * klanten waar deze medewerker toegang toe heeft, met variatie in de top.
 */
export async function listWeeklyTopIdeas(viewer: Viewer, limit = 12): Promise<WeeklyIdea[]> {
  const clientsList = await listClientsForScripts(viewer);
  const names = new Map(clientsList.filter((c) => c.active).map((c) => [c.id, c.name]));
  const looks = new Map(clientsList.map((c) => [c.id, { logoUrl: c.logoUrl, color: c.color }]));
  if (names.size === 0) return [];
  const scope = scopeToClients(viewer, contentIdeas.clientId);
  const since = new Date(Date.now() - 8 * 24 * 3600_000);
  const rows = await db
    .select({
      id: contentIdeas.id,
      clientId: contentIdeas.clientId,
      titel: contentIdeas.titel,
      hooks: contentIdeas.hooks,
      categorie: contentIdeas.categorie,
      opportunityScore: contentIdeas.opportunityScore,
      createdAt: contentIdeas.createdAt,
    })
    .from(contentIdeas)
    .where(and(isNull(contentIdeas.deletedAt), eq(contentIdeas.status, "nieuw"), gte(contentIdeas.createdAt, since), scope ?? undefined))
    .orderBy(desc(contentIdeas.opportunityScore))
    .limit(200);
  const mapped = rows
    .filter((r) => names.has(r.clientId))
    .map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: names.get(r.clientId)!,
      logoUrl: looks.get(r.clientId)?.logoUrl ?? null,
      color: looks.get(r.clientId)?.color ?? null,
      titel: r.titel,
      hook: Array.isArray(r.hooks) && typeof r.hooks[0] === "string" ? (r.hooks[0] as string) : null,
      categorie: String(r.categorie),
      opportunityScore: r.opportunityScore,
      createdAt: r.createdAt.toISOString(),
    }));
  // Variatie over klanten: niet de hele top voor één klant (rankWithVariety
  // spreidt op het veld "categorie", hier dus op klant).
  const byClient = rankWithVariety(mapped.map((m) => ({ ...m, kind: m.categorie, categorie: m.clientId })), 0.8);
  return byClient.slice(0, limit).map(({ kind, ...m }) => ({ ...m, categorie: kind }));
}

export type IdeaRow = typeof contentIdeas.$inferSelect;
export type RunRow = {
  id: string;
  status: string;
  phase: string;
  summary: string | null;
  trends: unknown;
  sources: unknown;
  strategicAdvice: unknown;
  dataBasis: unknown;
  heartbeatAt: Date | null;
  ideasCount: number;
  newCount: number;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

export type ClientResearch = {
  client: { id: string; name: string; slug: string; logoUrl: string | null; color: string | null };
  runs: RunRow[];
  ideas: IdeaRow[];
  dna: ContentDna;
  manualNotes: string;
  conversations: Array<{ id: string; title: string; lastMessageAt: Date | null; pinnedAt: Date | null }>;
  competitors: Array<typeof contentCompetitors.$inferSelect>;
  /** Loopt er nu een onderzoek (bezig én recente hartslag)? */
  running: boolean;
};

/** Volledige per-klant weergave (intern). Hard gescoopt op klanttoegang. */
export async function getClientContentResearch(viewer: Viewer, clientId: string): Promise<ClientResearch | null> {
  const [client] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, logoUrl: clients.logoUrl, color: clients.color })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return null;
  assertClientAccess(viewer, client.id);

  const [runs, ideas, dnaBundle, conversations, competitors] = await Promise.all([
    db
      .select({
        id: contentResearchRuns.id,
        status: contentResearchRuns.status,
        phase: contentResearchRuns.phase,
        summary: contentResearchRuns.summary,
        trends: contentResearchRuns.trends,
        sources: contentResearchRuns.sources,
        strategicAdvice: contentResearchRuns.strategicAdvice,
        dataBasis: contentResearchRuns.dataBasis,
        heartbeatAt: contentResearchRuns.heartbeatAt,
        ideasCount: contentResearchRuns.ideasCount,
        newCount: contentResearchRuns.newCount,
        errorMessage: contentResearchRuns.errorMessage,
        startedAt: contentResearchRuns.startedAt,
        finishedAt: contentResearchRuns.finishedAt,
        createdAt: contentResearchRuns.createdAt,
      })
      .from(contentResearchRuns)
      .where(and(eq(contentResearchRuns.clientId, clientId), isNull(contentResearchRuns.deletedAt)))
      .orderBy(desc(contentResearchRuns.createdAt))
      .limit(12),
    db
      .select()
      .from(contentIdeas)
      .where(and(eq(contentIdeas.clientId, clientId), isNull(contentIdeas.deletedAt)))
      .orderBy(desc(contentIdeas.opportunityScore), desc(contentIdeas.score), desc(contentIdeas.createdAt))
      .limit(200),
    loadDna(clientId),
    db
      .select({
        id: contentChatConversations.id,
        title: contentChatConversations.title,
        lastMessageAt: contentChatConversations.lastMessageAt,
        pinnedAt: contentChatConversations.pinnedAt,
      })
      .from(contentChatConversations)
      .where(and(eq(contentChatConversations.clientId, clientId), isNull(contentChatConversations.deletedAt)))
      .orderBy(desc(contentChatConversations.lastMessageAt))
      .limit(50),
    db
      .select()
      .from(contentCompetitors)
      .where(and(eq(contentCompetitors.clientId, clientId), isNull(contentCompetitors.deletedAt)))
      .orderBy(desc(contentCompetitors.actief), contentCompetitors.naam),
  ]);

  const latest = runs[0];
  const running = Boolean(
    latest && latest.status === "bezig" && (Date.now() - (latest.heartbeatAt ?? latest.createdAt).getTime()) / 60000 < STALE_MIN,
  );
  return { client, runs, ideas, dna: dnaBundle.dna, manualNotes: dnaBundle.manualNotes, conversations, competitors, running };
}

/**
 * Context voor de klantspecifieke "Spar met AI": alles wat het gesprek klant-
 * eigen maakt — Content DNA, eerdere feedback, opgeslagen ideeën, laatste
 * onderzoek en wat er bij deze klant aantoonbaar werkt (Video Intelligence).
 */
export async function buildContentContext(viewer: Viewer, clientId: string, clientName: string): Promise<string> {
  const [dnaBundle, feedback, learned, patterns, savedIdeas, lastRun, performance] = await Promise.all([
    loadDna(clientId),
    gatherFeedbackContext(clientId).catch(() => null),
    clientLearnedText(clientId).catch(() => ""),
    getClientWinningPatterns(viewer, clientId).catch(() => null),
    db
      .select({ titel: contentIdeas.titel, status: contentIdeas.status })
      .from(contentIdeas)
      .where(and(eq(contentIdeas.clientId, clientId), isNull(contentIdeas.deletedAt)))
      .orderBy(desc(contentIdeas.createdAt))
      .limit(40),
    db
      .select({ summary: contentResearchRuns.summary, finishedAt: contentResearchRuns.finishedAt })
      .from(contentResearchRuns)
      .where(and(eq(contentResearchRuns.clientId, clientId), eq(contentResearchRuns.status, "klaar"), isNull(contentResearchRuns.deletedAt)))
      .orderBy(desc(contentResearchRuns.finishedAt))
      .limit(1),
    buildPerformanceContext(clientId).catch(() => ({ text: "", hasData: false, laatsteRapportage: null })),
  ]);

  const parts: string[] = [`Klant: ${clientName}`];
  if (performance.text) parts.push(performance.text);
  const dnaText = dnaToText(dnaBundle.dna);
  if (dnaText) parts.push(`CONTENT DNA:\n${dnaText}`);
  if (dnaBundle.manualNotes.trim()) parts.push(`HANDMATIGE AANTEKENINGEN:\n${dnaBundle.manualNotes.trim()}`);
  if (learned) parts.push(`GELEERDE VOORKEUREN:\n${learned}`);
  if (feedback) {
    if (feedback.afspraken) parts.push(`AFSPRAKEN:\n${feedback.afspraken}`);
    if (feedback.recenteScriptfeedback.length) parts.push(`RECENTE SCRIPTFEEDBACK:\n- ${feedback.recenteScriptfeedback.join("\n- ")}`);
  }
  if (patterns && patterns.top.length) {
    const wins = patterns.top
      .map((p) => {
        const label = p.hook?.trim() || p.title?.trim();
        return label ? `${label} (${p.platform}, ${p.views.toLocaleString("nl-NL")} weergaven)` : null;
      })
      .filter((x): x is string => Boolean(x));
    if (wins.length) parts.push(`WAT WERKT BIJ DEZE KLANT (Video Intelligence):\n- ${wins.join("\n- ")}`);
  }
  const favs = savedIdeas.filter((i) => i.status === "favoriet" || i.status === "opgeslagen").map((i) => i.titel);
  if (favs.length) parts.push(`OPGESLAGEN/FAVORIETE IDEEËN:\n- ${favs.join("\n- ")}`);
  const otherIdeas = savedIdeas.filter((i) => i.status === "nieuw").map((i) => i.titel);
  if (otherIdeas.length) parts.push(`RECENTE IDEEËN:\n- ${otherIdeas.slice(0, 20).join("\n- ")}`);
  if (lastRun[0]?.summary) parts.push(`LAATSTE ONDERZOEK (samenvatting):\n${lastRun[0].summary}`);

  return parts.join("\n\n");
}
