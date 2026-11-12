import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCompetitors, contentIdeas, contentResearchRuns, users } from "@/db/schema";
import { env } from "@/lib/env";
import { aiModel } from "@/server/ai/client";
import { clientLearnedText } from "@/server/ai/knowledge";
import { gatherFeedbackContext } from "@/server/script-control";
import { notify } from "@/server/notifications";
import { recordActivity } from "@/server/audit";
import { ideateFromBriefing, runResearchBriefing } from "./generate";
import { buildPerformanceContext } from "./performance";
import { postAnalysisToText } from "./post-performance";
import {
  competitorsToText,
  loadClientMemoryCount,
  loadCompetitors,
  loadIdeaHistory,
  loadPostAnalysis,
  loadPriorScripts,
  loadToneOfVoice,
  priorScriptsToText,
} from "./sources";
import { normalizeOpportunity, opportunityTotal } from "./opportunity";
import { dnaToText, loadDna, mergeDna, saveDna } from "./content-dna";

/**
 * Een onderzoeksronde loopt in twee fases, elk in een EIGEN aanroep:
 *   1. zoeken  → web-onderzoek naar markt en concurrenten → briefing bewaard
 *   2. ideeen  → briefing + eigen data → ideeën met onderbouwing en score
 *
 * Waarom: één ronde kost samen 4–6 minuten, Vercel kapt een functie af na 5. Met
 * de oude opzet (beide fases + twee klanten per cron-aanroep) bleef de helft van
 * de rondes eeuwig op "bezig" staan. Nu bewaart elke fase zijn resultaat, houdt
 * de ronde een hartslag bij en pakt de cron een vastgelopen fase vanzelf weer op.
 */

/** Zonder hartslag in deze tijd geldt een fase als afgebroken (time-out). */
export const STALE_MIN = 7;
const MAX_ATTEMPTS = 3;

export const CREDIT_MESSAGE =
  "Het AI-tegoed (Anthropic) is op. Vul het tegoed aan in console.anthropic.com; het onderzoek wordt daarna vanzelf opnieuw gestart.";

export function isCreditError(message: string | null | undefined): boolean {
  return /credit balance|billing|insufficient.*credit/i.test(message ?? "");
}

function dedupeHash(titel: string, concept: string): string {
  const norm = `${titel} ${concept}`.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

function isStale(r: { heartbeatAt: Date | null; startedAt: Date | null; updatedAt: Date }): boolean {
  const last = r.heartbeatAt ?? r.startedAt ?? r.updatedAt;
  return (Date.now() - last.getTime()) / 60000 >= STALE_MIN;
}

export type LatestRun = {
  id: string;
  status: string;
  phase: string;
  stale: boolean;
};

export async function latestRun(clientId: string): Promise<LatestRun | null> {
  const [row] = await db
    .select({
      id: contentResearchRuns.id,
      status: contentResearchRuns.status,
      phase: contentResearchRuns.phase,
      heartbeatAt: contentResearchRuns.heartbeatAt,
      startedAt: contentResearchRuns.startedAt,
      updatedAt: contentResearchRuns.updatedAt,
    })
    .from(contentResearchRuns)
    .where(and(eq(contentResearchRuns.clientId, clientId), isNull(contentResearchRuns.deletedAt)))
    .orderBy(desc(contentResearchRuns.createdAt))
    .limit(1);
  if (!row) return null;
  return { id: row.id, status: row.status, phase: row.phase, stale: row.status === "bezig" && isStale(row) };
}

/** Loopt er nu écht iets (bezig én recente hartslag)? */
export async function hasActiveRun(clientId: string): Promise<boolean> {
  const r = await latestRun(clientId);
  return Boolean(r && r.status === "bezig" && !r.stale);
}

export async function startContentResearchRun(clientId: string, triggeredById?: string | null): Promise<string> {
  const [run] = await db
    .insert(contentResearchRuns)
    .values({
      clientId,
      status: "bezig",
      phase: "zoeken",
      startedAt: new Date(),
      heartbeatAt: new Date(),
      triggeredById: triggeredById ?? null,
    })
    .returning({ id: contentResearchRuns.id });
  return run!.id;
}

async function beat(runId: string, patch: Partial<typeof contentResearchRuns.$inferInsert> = {}) {
  await db
    .update(contentResearchRuns)
    .set({ ...patch, heartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(contentResearchRuns.id, runId));
}

/** Interne context: klantgeheugen, Content DNA, feedback en afspraken. */
async function buildInternalContext(clientId: string): Promise<string> {
  const [dnaBundle, feedback, learned] = await Promise.all([
    loadDna(clientId),
    gatherFeedbackContext(clientId).catch(() => null),
    clientLearnedText(clientId).catch(() => ""),
  ]);
  const parts: string[] = [];
  if (learned) parts.push(`KLANTGEHEUGEN (wat bij deze klant wel/niet werkt):\n${learned}`);
  const dnaText = dnaToText(dnaBundle.dna);
  if (dnaText) parts.push(`CONTENT DNA:\n${dnaText}`);
  if (dnaBundle.manualNotes.trim()) parts.push(`HANDMATIGE AANTEKENINGEN:\n${dnaBundle.manualNotes.trim()}`);
  if (feedback) {
    if (feedback.afspraken) parts.push(`COMMUNICATIE-AFSPRAKEN:\n${feedback.afspraken}`);
    if (feedback.recenteScriptfeedback.length) parts.push(`RECENTE SCRIPTFEEDBACK (klant):\n- ${feedback.recenteScriptfeedback.join("\n- ")}`);
    if (feedback.recenteKlantopmerkingen.length) parts.push(`RECENTE VIDEO-OPMERKINGEN (klant):\n- ${feedback.recenteKlantopmerkingen.join("\n- ")}`);
  }
  return parts.join("\n\n");
}

/** Alle databronnen in één keer, plus een eerlijke telling voor de UI. */
async function gatherSources(clientId: string, opts: { readScriptTexts: boolean }) {
  const [internal, posts, report, prior, competitors, memory, history, tone] = await Promise.all([
    buildInternalContext(clientId),
    loadPostAnalysis(clientId).catch(() => null),
    buildPerformanceContext(clientId).catch(() => ({ text: "", hasData: false, laatsteRapportage: null })),
    loadPriorScripts(clientId, { readTexts: opts.readScriptTexts }).catch(() => ({ count: 0, recent: [], texts: [] })),
    loadCompetitors(clientId).catch(() => []),
    loadClientMemoryCount(clientId).catch(() => 0),
    loadIdeaHistory(clientId),
    loadToneOfVoice(clientId).catch(() => ""),
  ]);
  const postsText = posts ? postAnalysisToText(posts) : "";
  const performanceText = [postsText, report.text].filter(Boolean).join("\n\n");
  const dataBasis = {
    posts: posts?.posts ?? 0,
    postsPeriode: posts?.periodeVan ? `${posts.periodeVan} t/m ${posts.periodeTot}` : null,
    platforms: posts?.platforms.map((p) => p.platform) ?? [],
    postZekerheid: posts?.zekerheid ?? "geen data",
    driveScripts: prior.count,
    scriptsGelezen: prior.texts.length,
    concurrenten: competitors.filter((c) => c.actief).length,
    klantgeheugen: memory,
    maandrapportage: report.laatsteRapportage,
    eerdereIdeeen: history.hashes.size,
    afgewezen: history.afgewezen,
  };
  return {
    internal,
    performanceText,
    hasPostData: (posts?.posts ?? 0) > 0,
    priorText: priorScriptsToText(prior),
    competitorsText: competitorsToText(competitors),
    competitors,
    history,
    tone,
    dataBasis,
  };
}

export type JobResult = { ok: boolean; reason?: string; message?: string; newCount?: number; phase?: string };

/**
 * Voert de VOLGENDE fase van een ronde uit (en de tweede alleen als daar nog
 * ruim tijd voor is). Faalt nooit hard: bij een fout gaat de ronde naar
 * 'mislukt' met een leesbare melding.
 */
export async function runContentResearchJob(runId: string, opts: { budgetMs?: number } = {}): Promise<JobResult> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 240_000;

  const [run] = await db
    .select()
    .from(contentResearchRuns)
    .where(eq(contentResearchRuns.id, runId))
    .limit(1);
  if (!run) return { ok: false, reason: "run_not_found" };
  if (run.status !== "bezig") return { ok: true, reason: "not_running" };

  const fail = async (message: string): Promise<JobResult> => {
    const credit = isCreditError(message);
    await db
      .update(contentResearchRuns)
      .set({
        status: "mislukt",
        phase: "klaar",
        errorMessage: (credit ? CREDIT_MESSAGE : message).slice(0, 500),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contentResearchRuns.id, runId));
    if (credit) await notifyCreditProblem().catch(() => undefined);
    return { ok: false, reason: credit ? "credit" : "error", message };
  };

  if (run.attempts >= MAX_ATTEMPTS) return fail(`Onderzoek ${MAX_ATTEMPTS}x afgebroken in fase "${run.phase}" (tijdslimiet).`);

  const [client] = await db
    .select({ id: clients.id, name: clients.name, sector: clients.sector })
    .from(clients)
    .where(and(eq(clients.id, run.clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return fail("Klant niet gevonden.");

  try {
    let briefing = run.briefing;

    /* ---------------- Fase 1: web-onderzoek ---------------- */
    if (!briefing) {
      await beat(runId, { phase: "zoeken", attempts: run.attempts + 1 });
      const src = await gatherSources(client.id, { readScriptTexts: false });
      const res = await runResearchBriefing({
        clientName: client.name,
        sector: client.sector,
        contextText: [src.internal, src.priorText].filter(Boolean).join("\n\n"),
        performanceText: src.performanceText,
        competitorsText: src.competitorsText,
      });
      if (!res.ok) return fail(res.reason === "no_provider" ? "Er is nog geen AI-sleutel ingesteld." : res.error ?? "Onderzoek mislukt.");
      briefing = res.text;
      // Fase 2 kost met Opus 2–3 minuten: alleen direct doorgaan als dat ruim past,
      // anders "wacht" zetten zodat de volgende aanroep (doorstart of cron) hem pakt.
      const continueNow = Date.now() - t0 <= budget - 180_000;
      await beat(runId, { phase: continueNow ? "ideeen" : "wacht", briefing, attempts: 0, dataBasis: src.dataBasis as unknown as Record<string, unknown> });
      if (!continueNow) return { ok: true, phase: "wacht" };
    }

    /* ---------------- Fase 2: ideeën ---------------- */
    const [fresh] = await db.select({ attempts: contentResearchRuns.attempts }).from(contentResearchRuns).where(eq(contentResearchRuns.id, runId)).limit(1);
    const phase2Attempts = fresh?.attempts ?? 0;
    await beat(runId, { phase: "ideeen", attempts: phase2Attempts + 1 });

    const src = await gatherSources(client.id, { readScriptTexts: true });
    const { dna, manualNotes } = await loadDna(client.id);
    const res = await ideateFromBriefing({
      clientName: client.name,
      briefing,
      dnaText: [dnaToText(dna), src.internal].filter(Boolean).join("\n\n"),
      existingIdeasText: src.history.text,
      priorScriptsText: src.priorText,
      performanceText: src.performanceText,
      toneText: src.tone,
      rejectedText: src.history.rejectedText,
      // Is deze fase al eens afgebroken (tijdslimiet)? Dan het snellere model.
      model: phase2Attempts >= 1 ? aiModel() : undefined,
    });
    if (!res.ok) return fail(res.reason === "no_provider" ? "Er is nog geen AI-sleutel ingesteld." : res.error ?? "Ideeën genereren mislukt.");

    await beat(runId, { phase: "opslaan" });

    const hasCompetitorSources = res.data.concurrenten.some((c) => c.observatie && /https?:\/\//.test(c.observatie)) || src.competitors.length > 0;
    let newCount = 0;
    const seen = new Set(src.history.hashes);
    for (const idea of res.data.ideeen) {
      const hash = dedupeHash(idea.titel, idea.concept);
      if (seen.has(hash)) continue;
      seen.add(hash);
      newCount++;
      const opportunity = normalizeOpportunity(idea.opportunity, { hasPostData: src.hasPostData, hasCompetitorSources }, idea.score);
      // "Eigen data"-onderbouwing zonder eigen data is per definitie een aanname.
      const onderbouwing = idea.onderbouwing.map((e) =>
        e.type === "eigen_data" && !src.hasPostData ? { ...e, zekerheid: "aanname" as const } : e,
      );
      await db.insert(contentIdeas).values({
        clientId: client.id,
        runId,
        titel: idea.titel,
        concept: idea.concept,
        hooks: idea.hooks as unknown as Record<string, unknown>,
        middenstuk: idea.middenstuk as unknown as Record<string, unknown>,
        ctaCommercieel: idea.ctaCommercieel || null,
        ctaInteractie: idea.ctaInteractie || null,
        waaromWerkt: idea.waaromWerkt || null,
        doel: idea.doel || null,
        inspiratieUrl: idea.inspiratieUrl,
        inspiratieLabel: idea.inspiratieLabel,
        categorie: idea.categorie as never,
        uitvoerbaarheid: idea.uitvoerbaarheid as never,
        score: idea.score,
        scoreReason: idea.scoreReason || null,
        invalshoek: idea.invalshoek || null,
        herhaalReden: idea.herhaalReden,
        onderbouwing: onderbouwing as unknown as Record<string, unknown>,
        opportunity: opportunity as unknown as Record<string, unknown>,
        opportunityScore: opportunityTotal(opportunity),
        dedupeHash: hash,
      });
    }

    // Concurrenten: nieuwe voorstellen toevoegen, bestaande observatie bijwerken.
    // Door het team uitgezette concurrenten blijven uit (actief=false blijft staan).
    const byName = new Map(src.competitors.map((c) => [c.naam.trim().toLowerCase(), c]));
    for (const c of res.data.concurrenten) {
      const existing = byName.get(c.naam.trim().toLowerCase());
      if (existing) {
        if (c.observatie) {
          await db
            .update(contentCompetitors)
            .set({ laatsteObservatie: c.observatie, laatsteObservatieOp: new Date(), updatedAt: new Date() })
            .where(eq(contentCompetitors.id, existing.id));
        }
        continue;
      }
      await db.insert(contentCompetitors).values({
        clientId: client.id,
        naam: c.naam,
        url: c.url,
        tiktok: c.tiktok,
        instagram: c.instagram,
        youtube: c.youtube,
        notitie: c.notitie || null,
        bron: "ai",
        actief: true,
        laatsteObservatie: c.observatie || null,
        laatsteObservatieOp: c.observatie ? new Date() : null,
      });
      byName.set(c.naam.trim().toLowerCase(), { naam: c.naam } as never);
    }

    await saveDna({
      clientId: client.id,
      dna: mergeDna(dna, res.data.contentDna),
      autoSummary: briefing.slice(0, 4000),
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
        strategicAdvice: res.data.strategischAdvies as unknown as Record<string, unknown>,
        dataBasis: { ...src.dataBasis, concurrenten: byName.size } as unknown as Record<string, unknown>,
        ideasCount: res.data.ideeen.length,
        newCount,
        attempts: 0,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contentResearchRuns.id, runId));

    // Alleen wie het onderzoek zelf startte krijgt een melding. De wekelijkse,
    // automatische rondes worden in één verzamelmelding gemeld (content_research.notify),
    // niet per klant: dat waren 17 meldingen per maandag.
    if (run.triggeredById) {
      await notify({
        userIds: [run.triggeredById],
        clientId: client.id,
        level: "info",
        type: "content_research",
        title: "Onderzoek klaar",
        body: `${newCount} nieuwe idee${newCount === 1 ? "" : "ën"} voor ${client.name}.`,
        href: `/ai/content-research/${client.id}`,
        entityType: "content_research_run",
        entityId: runId,
        dedupeKey: `content_research:${runId}`,
      }).catch(() => undefined);
    }
    await recordActivity({
      clientId: client.id,
      type: "content_research.generated",
      title: `Content Research: ${newCount} nieuwe idee${newCount === 1 ? "" : "ën"}`,
      isClientVisible: false,
    }).catch(() => undefined);

    return { ok: true, newCount, phase: "klaar" };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Eén melding per dag aan de eigenaar als het AI-tegoed op is. */
async function notifyCreditProblem() {
  const owners = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt)));
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  for (const o of owners) {
    await notify({
      userIds: [o.id],
      level: "warning",
      type: "content_research_credit",
      title: "AI-tegoed op: Content Research staat stil",
      body: CREDIT_MESSAGE,
      href: "/ai/content-research",
      dedupeKey: `content_research_credit:${o.id}:${day}`,
    });
  }
}

/** Was er vandaag al een tegoedfout? Dan starten we geen nieuwe rondes. */
export async function creditBlockedRecently(hours = 3): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contentResearchRuns)
    .where(
      and(
        eq(contentResearchRuns.status, "mislukt"),
        sql`${contentResearchRuns.finishedAt} > now() - (${hours} || ' hours')::interval`,
        sql`${contentResearchRuns.errorMessage} ilike '%tegoed%'`,
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * Start de volgende fase in een NIEUWE serverless-aanroep (eigen 5 minuten),
 * zodat een handmatig gestart onderzoek niet op de cron hoeft te wachten. Lukt
 * dat niet, dan pakt de cron (elke 5 minuten) het vanzelf op.
 */
export async function kickNextPhase(): Promise<void> {
  if (!env.CRON_SECRET || !env.APP_URL || env.APP_URL.includes("localhost")) return;
  try {
    await fetch(`${env.APP_URL}/api/jobs/run?job=content_research.advance`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    /* time-out is verwacht: de aanroep draait door, of de cron pakt het op */
  }
}

/** Voor scripts/tests: één ronde van begin tot eind. */
export async function runContentResearchForClient(
  clientId: string,
  opts: { triggeredById?: string | null; force?: boolean } = {},
): Promise<JobResult> {
  if (!opts.force && (await hasActiveRun(clientId))) return { ok: false, reason: "in_progress" };
  const runId = await startContentResearchRun(clientId, opts.triggeredById ?? null);
  const first = await runContentResearchJob(runId, { budgetMs: 10 * 60_000 });
  if (!first.ok || first.phase === "klaar") return first;
  return runContentResearchJob(runId, { budgetMs: 10 * 60_000 });
}
