import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  contentChatConversations,
  contentIdeas,
  contentResearchRuns,
} from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";
import { listClientsForScripts, clientLearnedText } from "@/server/ai/knowledge";
import { gatherFeedbackContext } from "@/server/script-control";
import { getClientWinningPatterns } from "@/server/scripts/winning-patterns";
import { loadDna, dnaToText, type ContentDna } from "./content-dna";

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
};

/** Overzicht: alle klanten (met actief-vlag) + hun idee-tellingen en laatste onderzoek. */
export async function listContentResearchOverview(viewer: Viewer): Promise<OverviewClient[]> {
  const clientsList = await listClientsForScripts(viewer);
  if (clientsList.length === 0) return [];
  const ids = new Set(clientsList.map((c) => c.id));

  const scope = scopeToClients(viewer, contentIdeas.clientId);
  const ideas = await db
    .select({ clientId: contentIdeas.clientId, status: contentIdeas.status })
    .from(contentIdeas)
    .where(and(isNull(contentIdeas.deletedAt), scope ?? undefined));

  const runScope = scopeToClients(viewer, contentResearchRuns.clientId);
  const runs = await db
    .select({
      clientId: contentResearchRuns.clientId,
      status: contentResearchRuns.status,
      finishedAt: contentResearchRuns.finishedAt,
      createdAt: contentResearchRuns.createdAt,
    })
    .from(contentResearchRuns)
    .where(and(isNull(contentResearchRuns.deletedAt), runScope ?? undefined))
    .orderBy(desc(contentResearchRuns.createdAt));

  const totals = new Map<string, number>();
  const news = new Map<string, number>();
  for (const i of ideas) {
    if (!ids.has(i.clientId) || i.status === "gearchiveerd" || i.status === "afgewezen") continue;
    totals.set(i.clientId, (totals.get(i.clientId) ?? 0) + 1);
    if (i.status === "nieuw") news.set(i.clientId, (news.get(i.clientId) ?? 0) + 1);
  }
  const lastAt = new Map<string, string>();
  const running = new Set<string>();
  for (const r of runs) {
    if (!ids.has(r.clientId)) continue;
    if (r.status === "bezig") running.add(r.clientId);
    if (r.status === "klaar" && r.finishedAt && !lastAt.has(r.clientId)) {
      lastAt.set(r.clientId, r.finishedAt.toISOString());
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
  }));
}

export type IdeaRow = typeof contentIdeas.$inferSelect;
export type RunRow = {
  id: string;
  status: string;
  phase: string;
  summary: string | null;
  trends: unknown;
  sources: unknown;
  ideasCount: number;
  newCount: number;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

export type ClientResearch = {
  client: { id: string; name: string; slug: string; logoUrl: string | null };
  runs: RunRow[];
  ideas: IdeaRow[];
  dna: ContentDna;
  manualNotes: string;
  conversations: Array<{ id: string; title: string; lastMessageAt: Date | null; pinnedAt: Date | null }>;
};

/** Volledige per-klant weergave (intern). Hard gescoopt op klanttoegang. */
export async function getClientContentResearch(viewer: Viewer, clientId: string): Promise<ClientResearch | null> {
  const [client] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, logoUrl: clients.logoUrl })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return null;
  assertClientAccess(viewer, client.id);

  const [runs, ideas, dnaBundle, conversations] = await Promise.all([
    db
      .select({
        id: contentResearchRuns.id,
        status: contentResearchRuns.status,
        phase: contentResearchRuns.phase,
        summary: contentResearchRuns.summary,
        trends: contentResearchRuns.trends,
        sources: contentResearchRuns.sources,
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
      .orderBy(desc(contentIdeas.score), desc(contentIdeas.createdAt))
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
  ]);

  return { client, runs, ideas, dna: dnaBundle.dna, manualNotes: dnaBundle.manualNotes, conversations };
}

/**
 * Context voor de klantspecifieke "Spar met AI": alles wat het gesprek klant-
 * eigen maakt — Content DNA, eerdere feedback, opgeslagen ideeën, laatste
 * onderzoek en wat er bij deze klant aantoonbaar werkt (Video Intelligence).
 */
export async function buildContentContext(viewer: Viewer, clientId: string, clientName: string): Promise<string> {
  const [dnaBundle, feedback, learned, patterns, savedIdeas, lastRun] = await Promise.all([
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
  ]);

  const parts: string[] = [`Klant: ${clientName}`];
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
