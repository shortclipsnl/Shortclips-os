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
import { ideateFromBriefing, runResearchBriefing, type IdeaDraft, type ResearchOutput } from "./generate";
import { judgeCandidates, pickRevisable, reviseCandidates, type JudgedCandidate } from "./judge";
import { nearDuplicate, pickShown, rankByQuality } from "./quality";
import { ensureStyleProfile, loadStoredStyle, videoEvidenceText } from "./style";
import { styleToText } from "./style-core";
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
import { dnaToText, loadDna, mergeDna, saveDna } from "./content-dna";

/**
 * Een onderzoeksronde loopt in vier fases, elk zo nodig in een EIGEN aanroep
 * (Vercel kapt een functie na 5 minuten af):
 *   1. stijl    → stijlprofiel uit de echte Shortclips-scripts (alleen als die
 *                 veranderden; anders direct door)
 *   2. zoeken   → web-onderzoek naar markt en concurrenten → briefing bewaard
 *   3. ideeen   → ±10 kandidaten in de stijl van de klant → bewaard op de ronde
 *   4. keuring  → strenge, aparte beoordeling; alleen 80+ met stijl-fit 8+ wordt
 *                 een idee voor het team. De rest blijft met reden in het archief.
 *   5. verbeteren → alleen als er minder dan 5 door zijn: de bijna-goede
 *                 kandidaten worden één keer herschreven op de punten van de
 *                 keuring en opnieuw gekeurd, met dezelfde drempel.
 *
 * Elke fase bewaart zijn resultaat en houdt een hartslag bij. Past de volgende
 * fase niet meer in de tijd, dan staat de ronde op "wacht_<fase>" en pakt de
 * doorstart of de cron hem op.
 */

export const PHASES = ["stijl", "zoeken", "ideeen", "keuring", "verbeteren"] as const;
export type Phase = (typeof PHASES)[number];
/** Ruime schatting per fase (ms), om te bepalen of de volgende nog past. */
const PHASE_MS: Record<Phase, number> = { stijl: 150_000, zoeken: 210_000, ideeen: 190_000, keuring: 150_000, verbeteren: 200_000 };

/** Opgeslagen fase → de fase die als volgende moet draaien. */
export function resumePhase(stored: string, hasBriefing: boolean, hasCandidates: boolean): Phase {
  const p = stored.startsWith("wacht_") ? stored.slice(6) : stored;
  if ((PHASES as readonly string[]).includes(p)) return p as Phase;
  // Oude rondes: "wacht" = wachten op ideeën; "opslaan" = na de ideeën.
  if (hasCandidates) return "keuring";
  if (hasBriefing) return "ideeen";
  return "zoeken";
}

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
      phase: "stijl",
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
async function gatherSources(clientId: string) {
  const [internal, posts, report, prior, competitors, memory, history, tone, style] = await Promise.all([
    buildInternalContext(clientId),
    loadPostAnalysis(clientId).catch(() => null),
    buildPerformanceContext(clientId).catch(() => ({ text: "", hasData: false, laatsteRapportage: null })),
    loadPriorScripts(clientId, { readTexts: false }).catch(() => ({ count: 0, recent: [], texts: [] })),
    loadCompetitors(clientId).catch(() => []),
    loadClientMemoryCount(clientId).catch(() => 0),
    loadIdeaHistory(clientId),
    loadToneOfVoice(clientId).catch(() => ""),
    loadStoredStyle(clientId),
  ]);
  const postsText = posts ? postAnalysisToText(posts) : "";
  const performanceText = [postsText, report.text].filter(Boolean).join("\n\n");
  const styleText = styleToText(style.profile, style.notes);
  const dataBasis = {
    posts: posts?.posts ?? 0,
    alleenVideo: true,
    postsPeriode: posts?.periodeVan ? `${posts.periodeVan} t/m ${posts.periodeTot}` : null,
    platforms: posts?.platforms.map((p) => p.platform) ?? [],
    postZekerheid: posts?.zekerheid ?? "geen data",
    driveScripts: prior.count,
    scriptsGelezen: style.sources.length,
    stijlBronnen: style.sources.map((s) => s.name),
    stijlBijgewerkt: style.updatedAt ? style.updatedAt.toISOString() : null,
    bewezenHooks: style.profile?.bewezenHooks.length ?? 0,
    concurrenten: competitors.filter((c) => c.actief).length,
    klantgeheugen: memory,
    maandrapportage: report.laatsteRapportage,
    eerdereIdeeen: history.hashes.size,
    afgewezen: history.afgewezen,
  };
  return {
    internal,
    posts,
    performanceText,
    hasVideoData: (posts?.posts ?? 0) >= 3,
    priorText: priorScriptsToText(prior),
    competitorsText: competitorsToText(competitors),
    competitors,
    history,
    tone,
    style,
    styleText,
    dataBasis,
  };
}

export type JobResult = { ok: boolean; reason?: string; message?: string; newCount?: number; phase?: string };

/** Wat er na fase "ideeen" (en na de keuring) op de ronde staat. */
export type StoredCandidates = {
  output: Omit<ResearchOutput, "briefing">;
  /** Na de keuring: alle kandidaten met hun uitslag. */
  beoordeeld?: Array<{
    titel: string;
    concept: string;
    hooks: string[];
    verwijderdeHooks: string[];
    keuring: JudgedCandidate["keuring"];
    getoond: boolean;
    reden: string | null;
  }>;
  /** Na fase "keuring": alle gekeurde kandidaten (volledig) en de duplicaten. */
  gekeurd?: JudgedCandidate[];
  dubbel?: string[];
  /** Aantal herschreven kandidaten in de verbeterronde. */
  verbeterd?: number;
};

/** Maximaal aantal ideeën per ronde dat het team te zien krijgt. */
const MAX_SHOWN = 5;

/**
 * Voert de volgende fase(s) van een ronde uit, zolang dat binnen het budget
 * past. Faalt nooit hard: bij een fout gaat de ronde naar 'mislukt' met een
 * leesbare melding.
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
  const aiFail = (res: { reason: string; error?: string }, fallback: string) =>
    fail(res.reason === "no_provider" ? "Er is nog geen AI-sleutel ingesteld." : res.error ?? fallback);

  const [client] = await db
    .select({ id: clients.id, name: clients.name, sector: clients.sector })
    .from(clients)
    .where(and(eq(clients.id, run.clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return fail("Klant niet gevonden.");

  let briefing = run.briefing;
  let candidates = (run.kandidaten as StoredCandidates | null) ?? null;
  let phase: Phase = resumePhase(run.phase, Boolean(briefing), Boolean(candidates?.output));
  // Pogingen tellen alleen door als we dezelfde fase opnieuw starten (time-out).
  let attempts = run.phase === phase ? run.attempts + 1 : 1;

  try {
    // Afgebroken tijdens het opslaan: alleen het opslaan afmaken (niet opnieuw keuren).
    if (run.phase === "opslaan" && candidates?.gekeurd) return await finalize({ runId, run, client, candidates });

    for (;;) {
      if (attempts > MAX_ATTEMPTS) return fail(`Onderzoek ${MAX_ATTEMPTS}x afgebroken in fase "${phase}" (tijdslimiet).`);
      await beat(runId, { phase, attempts });

      if (phase === "stijl") {
        /* ---------- 1. Stijlprofiel uit de echte scripts ---------- */
        const posts = await loadPostAnalysis(client.id).catch(() => null);
        const res = await ensureStyleProfile(client.id, client.name, { videoAnalysis: posts });
        // Mislukt het profiel, dan gaan we door met het bestaande (of zonder):
        // de keuring blijft streng, dus er komen dan eerder minder ideeën.
        if (!res.ok && isCreditError(res.error)) return fail(res.error ?? "AI-tegoed op");
      } else if (phase === "zoeken") {
        /* ---------- 2. Web-onderzoek ---------- */
        const src = await gatherSources(client.id);
        const res = await runResearchBriefing({
          clientName: client.name,
          sector: client.sector,
          contextText: [src.internal, src.styleText ? `STIJLPROFIEL:\n${src.styleText}` : "", src.priorText].filter(Boolean).join("\n\n"),
          performanceText: src.performanceText,
          competitorsText: src.competitorsText,
        });
        if (!res.ok) return aiFail(res, "Onderzoek mislukt.");
        briefing = res.text;
        await beat(runId, { briefing, dataBasis: src.dataBasis as unknown as Record<string, unknown> });
      } else if (phase === "ideeen") {
        /* ---------- 3. Kandidaten ---------- */
        const src = await gatherSources(client.id);
        const { dna } = await loadDna(client.id);
        const res = await ideateFromBriefing({
          clientName: client.name,
          briefing: briefing ?? "",
          dnaText: [dnaToText(dna), src.internal].filter(Boolean).join("\n\n"),
          existingIdeasText: src.history.text,
          priorScriptsText: src.priorText,
          performanceText: src.performanceText,
          styleText: src.styleText,
          toneText: src.tone,
          rejectedText: src.history.rejectedText,
          // Al eens afgebroken (tijdslimiet)? Dan het snellere model.
          model: attempts >= 2 ? aiModel() : undefined,
        });
        if (!res.ok) return aiFail(res, "Ideeën genereren mislukt.");
        const output: Partial<ResearchOutput> = { ...res.data };
        delete output.briefing;
        candidates = { output: output as Omit<ResearchOutput, "briefing"> };
        await beat(runId, { kandidaten: candidates as unknown as Record<string, unknown>, dataBasis: src.dataBasis as unknown as Record<string, unknown> });
      } else if (phase === "keuring") {
        /* ---------- 4. Keuring ---------- */
        if (!candidates?.output) return fail("Geen kandidaten om te keuren.");
        const res = await judgePhase({ client, candidates, model: attempts >= 2 ? aiModel() : undefined });
        if (!res.ok) return fail(res.error);
        candidates = res.candidates;
        await beat(runId, { kandidaten: candidates as unknown as Record<string, unknown> });
        // Genoeg door, of niets wat een verbeterronde waard is: direct opslaan.
        const passed = candidates.gekeurd!.filter((c) => c.keuring.geslaagd).length;
        if (pickRevisable(candidates.gekeurd!, MAX_SHOWN - passed).length === 0) {
          return await finalize({ runId, run, client, candidates });
        }
      } else {
        /* ---------- 5. Verbeterronde + opslaan ---------- */
        if (!candidates?.gekeurd) return fail("Geen gekeurde kandidaten.");
        candidates = await revisePhase({ client, briefing: briefing ?? "", candidates, model: attempts >= 2 ? aiModel() : undefined });
        return await finalize({ runId, run, client, candidates });
      }

      const next = PHASES[PHASES.indexOf(phase) + 1]!;
      const elapsed = Date.now() - t0;
      if (elapsed + PHASE_MS[next] > budget) {
        await beat(runId, { phase: `wacht_${next}`, attempts: 0 });
        await kickNextPhase();
        return { ok: true, phase: `wacht_${next}` };
      }
      phase = next;
      attempts = 1;
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Duplicaten eruit, daarna de strenge keuring van alle kandidaten. */
async function judgePhase(ctx: {
  client: { id: string; name: string };
  candidates: StoredCandidates;
  model?: string;
}): Promise<{ ok: true; candidates: StoredCandidates } | { ok: false; error: string }> {
  const { client, candidates } = ctx;
  const src = await gatherSources(client.id);
  const seen = new Set(src.history.hashes);
  const fresh: IdeaDraft[] = [];
  const dubbel: string[] = [];
  for (const c of candidates.output.ideeen) {
    const h = dedupeHash(c.titel, c.concept);
    if (seen.has(h)) dubbel.push(c.titel);
    else {
      seen.add(h);
      fresh.push(c);
    }
  }
  const res = await judgeCandidates({
    clientName: client.name,
    styleText: src.styleText,
    videoText: videoEvidenceText(src.posts),
    existingText: existingForJudge(src),
    candidates: fresh,
    hasVideoData: src.hasVideoData,
    hasProvenHooks: (src.style.profile?.bewezenHooks.length ?? 0) > 0,
    model: ctx.model,
  });
  if (!res.ok) return { ok: false, error: `Keuring mislukt: ${res.error}` };
  return { ok: true, candidates: { ...candidates, gekeurd: res.judged, dubbel } };
}

function existingForJudge(src: Awaited<ReturnType<typeof gatherSources>>): string {
  return [
    src.style.profile?.onderwerpen.length ? `Onderwerpen uit de scripts: ${src.style.profile.onderwerpen.join(" · ")}` : "",
    src.history.text,
  ].filter(Boolean).join("\n");
}

/**
 * Eén verbeterronde voor de bijna-goede kandidaten. Een herschreven versie
 * vervangt het origineel alleen als die bij de herkeuring beter scoort. Mislukt
 * de ronde, dan blijft de eerste keuring gewoon staan.
 */
async function revisePhase(ctx: {
  client: { id: string; name: string };
  briefing: string;
  candidates: StoredCandidates;
  model?: string;
}): Promise<StoredCandidates> {
  const { client, candidates } = ctx;
  const gekeurd = candidates.gekeurd ?? [];
  const passed = gekeurd.filter((c) => c.keuring.geslaagd).length;
  const targets = pickRevisable(gekeurd, MAX_SHOWN - passed);
  if (targets.length === 0) return candidates;
  const src = await gatherSources(client.id);
  const rev = await reviseCandidates({ clientName: client.name, styleText: src.styleText, briefing: ctx.briefing, items: targets, model: ctx.model });
  if (!rev.ok || rev.revised.length === 0) return candidates;
  const rejudged = await judgeCandidates({
    clientName: client.name,
    styleText: src.styleText,
    videoText: videoEvidenceText(src.posts),
    existingText: existingForJudge(src),
    candidates: rev.revised.map((r) => r.idea),
    hasVideoData: src.hasVideoData,
    hasProvenHooks: (src.style.profile?.bewezenHooks.length ?? 0) > 0,
    model: ctx.model,
  });
  if (!rejudged.ok) return candidates;
  const next = [...gekeurd];
  let verbeterd = 0;
  rev.revised.forEach((r, i) => {
    const after = rejudged.judged[i];
    const before = r.from;
    if (!after || !before) return;
    const idx = next.indexOf(before);
    if (idx >= 0 && after.keuring.totaal > before.keuring.totaal) {
      next[idx] = { ...after, keuring: { ...after.keuring, oordeel: `Na verbeterronde: ${after.keuring.oordeel}` } };
      verbeterd++;
    }
  });
  return { ...candidates, gekeurd: next, verbeterd };
}

/** Getoonde ideeën opslaan, concurrenten en DNA bijwerken, ronde afronden. */
async function finalize(ctx: {
  runId: string;
  run: typeof contentResearchRuns.$inferSelect;
  client: { id: string; name: string };
  candidates: StoredCandidates;
}): Promise<JobResult> {
  const { runId, run, client, candidates } = ctx;
  const out = candidates.output;
  const src = await gatherSources(client.id);
  const dupes = candidates.dubbel ?? [];
  const ranked = rankByQuality(candidates.gekeurd ?? []);
  const shown = pickShown(ranked, MAX_SHOWN);
  const shownSet = new Set(shown);

  await beat(runId, { phase: "opslaan" });

  for (const idea of shown) {
    const k = idea.keuring;
    // Al opgeslagen (bijv. bij een herstart na een time-out tijdens het opslaan)?
    if (src.history.hashes.has(dedupeHash(idea.titel, idea.concept))) continue;
    // "Eigen data"-onderbouwing zonder videodata is per definitie een aanname.
    const onderbouwing = idea.onderbouwing.map((e) =>
      e.type === "eigen_data" && !src.hasVideoData ? { ...e, zekerheid: "aanname" as const } : e,
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
      waaromWerkt: k.oordeel || null,
      doel: idea.doel || null,
      inspiratieUrl: idea.inspiratieUrl,
      inspiratieLabel: idea.inspiratieLabel,
      categorie: idea.categorie as never,
      uitvoerbaarheid: idea.uitvoerbaarheid as never,
      score: Math.max(1, Math.round(k.totaal / 10)),
      scoreReason: k.oordeel || null,
      invalshoek: idea.invalshoek || null,
      herhaalReden: idea.herhaalReden,
      onderbouwing: onderbouwing as unknown as Record<string, unknown>,
      keuring: k as unknown as Record<string, unknown>,
      opportunityScore: k.totaal,
      dedupeHash: dedupeHash(idea.titel, idea.concept),
    });
  }

  const beoordeeld: NonNullable<StoredCandidates["beoordeeld"]> = [
    ...ranked.map((c) => ({
      titel: c.titel,
      concept: c.concept,
      hooks: c.hooks,
      verwijderdeHooks: c.verwijderdeHooks,
      keuring: c.keuring,
      getoond: shownSet.has(c),
      reden: shownSet.has(c) ? null : c.keuring.afwijsReden ?? (shown.some((x) => nearDuplicate(x, c)) ? "lijkt op een getoond idee" : `buiten de top ${MAX_SHOWN}`),
    })),
    ...dupes.map((t) => ({
      titel: t,
      concept: "",
      hooks: [],
      verwijderdeHooks: [],
      keuring: { totaal: 0, geslaagd: false, onderdelen: {} as JudgedCandidate["keuring"]["onderdelen"], oordeel: "", stijlProblemen: [], afwijsReden: "al eerder voorgesteld" },
      getoond: false,
      reden: "al eerder voorgesteld",
    })),
  ];

  // Concurrenten: nieuwe voorstellen toevoegen, bestaande observatie bijwerken.
  // Door het team uitgezette concurrenten blijven uit (actief=false blijft staan).
  const byName = new Map(src.competitors.map((c) => [c.naam.trim().toLowerCase(), c]));
  for (const c of out.concurrenten) {
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

  const { dna, manualNotes } = await loadDna(client.id);
  await saveDna({
    clientId: client.id,
    dna: mergeDna(dna, out.contentDna),
    autoSummary: (run.briefing ?? "").slice(0, 4000),
    manualNotes,
  });

  const newCount = shown.length;
  await db
    .update(contentResearchRuns)
    .set({
      status: "klaar",
      phase: "klaar",
      summary: out.trends.join("\n").slice(0, 4000) || null,
      trends: out.trends as unknown as Record<string, unknown>,
      sources: out.sources as unknown as Record<string, unknown>,
      strategicAdvice: out.strategischAdvies as unknown as Record<string, unknown>,
      // Volledige gekeurde kandidaten niet dubbel bewaren: de samenvatting volstaat.
      kandidaten: { output: { ...out, ideeen: [] }, beoordeeld, dubbel: dupes, verbeterd: candidates.verbeterd ?? 0 } as unknown as Record<string, unknown>,
      dataBasis: {
        ...src.dataBasis,
        concurrenten: byName.size,
        kandidaten: out.ideeen.length,
        geslaagd: ranked.filter((c) => c.keuring.geslaagd).length,
        verbeterd: candidates.verbeterd ?? 0,
        getoond: newCount,
      } as unknown as Record<string, unknown>,
      ideasCount: out.ideeen.length,
      newCount,
      attempts: 0,
      finishedAt: new Date(),
      heartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(contentResearchRuns.id, runId));

  // Alleen wie het onderzoek zelf startte krijgt een melding. De wekelijkse,
  // automatische rondes worden in één verzamelmelding gemeld (content_research.notify).
  if (run.triggeredById) {
    await notify({
      userIds: [run.triggeredById],
      clientId: client.id,
      level: "info",
      type: "content_research",
      title: "Onderzoek klaar",
      body: newCount
        ? `${newCount} idee${newCount === 1 ? "" : "ën"} door de keuring voor ${client.name}.`
        : `Geen idee haalde deze keer de keuring voor ${client.name}. Zie Onderzoek & historie.`,
      href: `/ai/content-research/${client.id}`,
      entityType: "content_research_run",
      entityId: runId,
      dedupeKey: `content_research:${runId}`,
    }).catch(() => undefined);
  }
  await recordActivity({
    clientId: client.id,
    type: "content_research.generated",
    title: `Content Research: ${newCount} van ${out.ideeen.length} kandidaten door de keuring`,
    isClientVisible: false,
  }).catch(() => undefined);

  return { ok: true, newCount, phase: "klaar" };
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
  let res: JobResult = { ok: false };
  for (let i = 0; i < 6; i++) {
    res = await runContentResearchJob(runId, { budgetMs: 15 * 60_000 });
    if (!res.ok || res.phase === "klaar" || res.reason === "not_running") return res;
  }
  return res;
}
