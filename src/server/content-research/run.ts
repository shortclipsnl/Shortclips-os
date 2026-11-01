import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentIdeas, contentResearchRuns, scripts } from "@/db/schema";
import { clientLearnedText } from "@/server/ai/knowledge";
import { gatherFeedbackContext } from "@/server/script-control";
import { notify } from "@/server/notifications";
import { recordActivity } from "@/server/audit";
import { researchAndIdeate } from "./generate";
import { dnaToText, loadDna, mergeDna, saveDna } from "./content-dna";

const STALE_RUNNING_MIN = 10;

function dedupeHash(titel: string, concept: string): string {
  const norm = `${titel} ${concept}`.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

/** Is er al een recente, lopende onderzoeksronde voor deze klant? */
export async function hasActiveRun(clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: contentResearchRuns.status, startedAt: contentResearchRuns.startedAt })
    .from(contentResearchRuns)
    .where(and(eq(contentResearchRuns.clientId, clientId), isNull(contentResearchRuns.deletedAt)))
    .orderBy(desc(contentResearchRuns.createdAt))
    .limit(1);
  if (!row || row.status !== "bezig") return false;
  if (!row.startedAt) return true;
  return (Date.now() - row.startedAt.getTime()) / 60000 < STALE_RUNNING_MIN;
}

/** Maakt een nieuwe onderzoeksronde aan (status 'bezig') en geeft het id terug. */
export async function startContentResearchRun(clientId: string, triggeredById?: string | null): Promise<string> {
  const [run] = await db
    .insert(contentResearchRuns)
    .values({ clientId, status: "bezig", phase: "zoeken", startedAt: new Date(), triggeredById: triggeredById ?? null })
    .returning({ id: contentResearchRuns.id });
  return run!.id;
}

async function buildResearchContext(clientId: string): Promise<string> {
  const [scriptRows, dnaBundle, feedback, learned] = await Promise.all([
    db
      .select({ title: scripts.title, format: scripts.format })
      .from(scripts)
      .where(and(eq(scripts.clientId, clientId), isNull(scripts.deletedAt)))
      .orderBy(desc(scripts.createdAt))
      .limit(50),
    loadDna(clientId),
    gatherFeedbackContext(clientId).catch(() => null),
    clientLearnedText(clientId).catch(() => ""),
  ]);

  const parts: string[] = [];
  const dnaText = dnaToText(dnaBundle.dna);
  if (dnaText) parts.push(`CONTENT DNA:\n${dnaText}`);
  if (dnaBundle.manualNotes.trim()) parts.push(`HANDMATIGE AANTEKENINGEN:\n${dnaBundle.manualNotes.trim()}`);
  if (learned) parts.push(`GELEERDE VOORKEUREN:\n${learned}`);
  if (feedback) {
    if (feedback.afspraken) parts.push(`COMMUNICATIE-AFSPRAKEN:\n${feedback.afspraken}`);
    if (feedback.aandachtspunten) parts.push(`EDITING-AANDACHTSPUNTEN:\n${feedback.aandachtspunten}`);
    if (feedback.recenteScriptfeedback.length) parts.push(`RECENTE SCRIPTFEEDBACK (klant):\n- ${feedback.recenteScriptfeedback.join("\n- ")}`);
    if (feedback.recenteKlantopmerkingen.length) parts.push(`RECENTE VIDEO-OPMERKINGEN (klant):\n- ${feedback.recenteKlantopmerkingen.join("\n- ")}`);
  }
  if (scriptRows.length) {
    parts.push(`EERDERE SCRIPTS/ONDERWERPEN (niet herhalen):\n- ${scriptRows.map((s) => s.title).filter(Boolean).join("\n- ")}`);
  }
  return parts.join("\n\n");
}

async function existingIdeasText(clientId: string): Promise<{ text: string; hashes: Set<string> }> {
  const rows = await db
    .select({ titel: contentIdeas.titel, concept: contentIdeas.concept, hash: contentIdeas.dedupeHash })
    .from(contentIdeas)
    .where(and(eq(contentIdeas.clientId, clientId), isNull(contentIdeas.deletedAt)))
    .orderBy(desc(contentIdeas.createdAt))
    .limit(60);
  const hashes = new Set(rows.map((r) => r.hash).filter((h): h is string => Boolean(h)));
  const text = rows.map((r) => `- ${r.titel}${r.concept ? `: ${r.concept.slice(0, 140)}` : ""}`).join("\n");
  return { text, hashes };
}

async function priorScriptsText(clientId: string): Promise<string> {
  const rows = await db
    .select({ title: scripts.title })
    .from(scripts)
    .where(and(eq(scripts.clientId, clientId), isNull(scripts.deletedAt)))
    .orderBy(desc(scripts.createdAt))
    .limit(60);
  return rows.map((r) => `- ${r.title}`).filter((l) => l.length > 2).join("\n");
}

/**
 * De eigenlijke onderzoeksworker voor één ronde. Draait als systeem (via `after()`
 * vanuit de actie, of inline vanuit de cron). Faalt nooit hard: bij een fout gaat
 * de ronde naar 'mislukt' met een melding.
 */
export async function runContentResearchJob(runId: string): Promise<{ ok: boolean; reason?: string; newCount?: number }> {
  const [run] = await db
    .select({ id: contentResearchRuns.id, clientId: contentResearchRuns.clientId, status: contentResearchRuns.status })
    .from(contentResearchRuns)
    .where(eq(contentResearchRuns.id, runId))
    .limit(1);
  if (!run) return { ok: false, reason: "run_not_found" };

  const fail = async (message: string) => {
    await db
      .update(contentResearchRuns)
      .set({ status: "mislukt", phase: "klaar", errorMessage: message.slice(0, 500), finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(contentResearchRuns.id, runId));
    return { ok: false, reason: "error", message } as const;
  };

  const [client] = await db
    .select({ id: clients.id, name: clients.name, sector: clients.sector, coordinatorId: clients.coordinatorId })
    .from(clients)
    .where(and(eq(clients.id, run.clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return fail("Klant niet gevonden.");

  try {
    const [contextText, existing, priorText] = await Promise.all([
      buildResearchContext(client.id),
      existingIdeasText(client.id),
      priorScriptsText(client.id),
    ]);
    const { dna, manualNotes } = await loadDna(client.id);

    await db.update(contentResearchRuns).set({ phase: "ideeen", updatedAt: new Date() }).where(eq(contentResearchRuns.id, runId));

    const res = await researchAndIdeate({
      clientName: client.name,
      sector: client.sector,
      contextText,
      dnaText: dnaToText(dna),
      existingIdeasText: existing.text,
      priorScriptsText: priorText,
    });
    if (!res.ok) {
      return fail(res.reason === "no_provider" ? "Er is nog geen AI-sleutel ingesteld." : res.error ?? "Onderzoek mislukt.");
    }

    await db.update(contentResearchRuns).set({ phase: "opslaan", updatedAt: new Date() }).where(eq(contentResearchRuns.id, runId));

    // Dedupe tegen bestaande ideeën; bestaande ideeën blijven behouden.
    let newCount = 0;
    const seen = new Set(existing.hashes);
    for (const idea of res.data.ideeen) {
      const hash = dedupeHash(idea.titel, idea.concept);
      if (seen.has(hash)) continue;
      seen.add(hash);
      newCount++;
      await db.insert(contentIdeas).values({
        clientId: client.id,
        runId,
        titel: idea.titel,
        concept: idea.concept,
        hooks: idea.hooks as unknown as Record<string, unknown>,
        waaromWerkt: idea.waaromWerkt || null,
        inspiratieUrl: idea.inspiratieUrl,
        inspiratieLabel: idea.inspiratieLabel,
        categorie: idea.categorie as never,
        uitvoerbaarheid: idea.uitvoerbaarheid as never,
        score: idea.score,
        scoreReason: idea.scoreReason || null,
        dedupeHash: hash,
      });
    }

    // Content DNA bijwerken (merge: behoud cumulatieve accept/reject + handmatig).
    await saveDna({
      clientId: client.id,
      dna: mergeDna(dna, res.data.contentDna),
      autoSummary: res.data.briefing.slice(0, 4000),
      manualNotes,
    });

    await db
      .update(contentResearchRuns)
      .set({
        status: "klaar",
        phase: "klaar",
        summary: res.data.trends.join("\n").slice(0, 4000) || null,
        trends: res.data.trends as unknown as Record<string, unknown>,
        sources: res.data.sources as unknown as Record<string, unknown>,
        ideasCount: res.data.ideeen.length,
        newCount,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contentResearchRuns.id, runId));

    const userIds = client.coordinatorId ? [client.coordinatorId] : undefined;
    await notify({
      roles: ["project_coordinator"],
      userIds,
      clientId: client.id,
      level: "info",
      type: "content_research",
      title: "Nieuwe content-ideeën klaar",
      body: `AI Content Research vond ${newCount} nieuwe idee${newCount === 1 ? "" : "ën"} voor ${client.name}.`,
      href: `/ai/content-research/${client.id}`,
      entityType: "content_research_run",
      entityId: runId,
      dedupeKey: `content_research:${runId}`,
    }).catch(() => undefined);
    await recordActivity({
      clientId: client.id,
      type: "content_research.generated",
      title: `AI Content Research: ${newCount} nieuwe idee${newCount === 1 ? "" : "ën"}`,
      isClientVisible: false,
    }).catch(() => undefined);

    return { ok: true, newCount };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Voor de cron: één ronde van begin tot eind (synchroon). */
export async function runContentResearchForClient(
  clientId: string,
  opts: { triggeredById?: string | null; force?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; newCount?: number }> {
  if (!opts.force && (await hasActiveRun(clientId))) return { ok: false, reason: "in_progress" };
  const runId = await startContentResearchRun(clientId, opts.triggeredById ?? null);
  return runContentResearchJob(runId);
}
