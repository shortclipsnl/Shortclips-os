import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientResearchRuns, clients } from "@/db/schema";
import { env } from "@/lib/env";
import { aiConfigured, aiModelStrong, runJsonPrompt, runResearch, runStructured } from "@/server/ai/client";
import { notify } from "@/server/notifications";
import { recordActivity } from "@/server/audit";
import { todayAmsterdam } from "@/lib/planning-deadline";
import {
  BASELINE_METRICS,
  RESEARCH_MODULES,
  RESEARCH_PHASES,
  TEXT_MODULES,
  compareBaselines,
  normalizeDossier,
  normalizeSources,
  platformLabel,
  resumePhase,
  type BaselineChange,
  type BaselineRow,
  type Dossier,
  type ResearchPhase,
  type ResearchSource,
} from "@/lib/client-research";
import { basisOf, collectInternal, competitorsToText, internalToText, linkedBaseline, type InternalData } from "./collect";
import {
  COMPANY_RESEARCH_SYSTEM,
  DOSSIER_SCHEMA,
  DOSSIER_SYSTEM,
  SOCIAL_RESEARCH_SYSTEM,
  STRATEGY_SCHEMA,
  STRATEGY_SYSTEM,
  companyResearchUser,
  dossierUser,
  socialResearchUser,
  strategyUser,
} from "./prompts";

/**
 * Een klantonderzoek loopt in vijf fases, elk zo nodig in een EIGEN aanroep
 * (Vercel kapt een functie na 5 minuten af):
 *   1. intern    → wat weten we zelf al (klantgegevens, kanalen, briefing,
 *                  gekoppelde cijfers). Geen AI.
 *   2. bedrijf   → webonderzoek: bedrijf, doelgroep, software en reviews.
 *   3. social    → webonderzoek: kanalen, content en concurrenten.
 *   4. dossier   → de briefings worden het dossier (modules 1 t/m 8).
 *   5. strategie → commerciële kansen en het eerste strategieadvies.
 *
 * Elke fase bewaart zijn resultaat en houdt een hartslag bij. Past de volgende
 * fase niet meer in de tijd, dan staat de ronde op "wacht_<fase>" en pakt de
 * doorstart of de cron hem op. Na de laatste fase staat het dossier op
 * "controle": een mens keurt het goed voordat er iets wordt doorgezet.
 */

const PHASE_MS: Record<ResearchPhase, number> = { intern: 10_000, bedrijf: 220_000, social: 220_000, dossier: 170_000, strategie: 170_000 };
export const STALE_MIN = 7;
const MAX_ATTEMPTS = 3;

export const CREDIT_MESSAGE =
  "Het AI-tegoed (Anthropic) is op. Vul het tegoed aan in console.anthropic.com en start het onderzoek daarna opnieuw.";
const NO_PROVIDER_MESSAGE = "Er is geen AI-sleutel ingesteld (ANTHROPIC_API_KEY), dus het onderzoek kan niet draaien.";

const isCreditError = (m: string | null | undefined) => /credit balance|billing|insufficient.*credit/i.test(m ?? "");

export type ResearchChanges = { cijfers: BaselineChange[]; inhoud: string[] };
export type JobResult = { ok: boolean; phase?: string; reason?: string };

type Run = typeof clientResearchRuns.$inferSelect;

async function beat(runId: string, patch: Partial<typeof clientResearchRuns.$inferInsert> = {}) {
  await db.update(clientResearchRuns).set({ ...patch, heartbeatAt: new Date(), updatedAt: new Date() }).where(eq(clientResearchRuns.id, runId));
}

function isStale(r: { heartbeatAt: Date | null; startedAt: Date | null; updatedAt: Date }): boolean {
  const last = r.heartbeatAt ?? r.startedAt ?? r.updatedAt;
  return (Date.now() - last.getTime()) / 60000 >= STALE_MIN;
}

/** Loopt er nu echt een onderzoek voor deze klant (bezig en recente hartslag)? */
export async function hasActiveResearch(clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ heartbeatAt: clientResearchRuns.heartbeatAt, startedAt: clientResearchRuns.startedAt, updatedAt: clientResearchRuns.updatedAt, phase: clientResearchRuns.phase })
    .from(clientResearchRuns)
    .where(and(eq(clientResearchRuns.clientId, clientId), eq(clientResearchRuns.status, "bezig"), isNull(clientResearchRuns.deletedAt)))
    .orderBy(desc(clientResearchRuns.createdAt))
    .limit(1);
  return Boolean(row && (row.phase.startsWith("wacht_") || !isStale(row)));
}

/**
 * Start een onderzoek. Het eerste onderzoek van een klant is de nulmeting;
 * zodra er een afgerond onderzoek ligt, is elke nieuwe ronde een hercontrole.
 */
export async function startClientResearch(clientId: string, triggeredById: string | null): Promise<string> {
  const [earlier] = await db
    .select({ id: clientResearchRuns.id })
    .from(clientResearchRuns)
    .where(and(eq(clientResearchRuns.clientId, clientId), inArray(clientResearchRuns.status, ["controle", "goedgekeurd"]), isNull(clientResearchRuns.deletedAt)))
    .limit(1);
  const [run] = await db
    .insert(clientResearchRuns)
    .values({
      clientId,
      kind: earlier ? "hercontrole" : "nulmeting",
      status: "bezig",
      phase: "intern",
      startedAt: new Date(),
      heartbeatAt: new Date(),
      triggeredById,
    })
    .returning({ id: clientResearchRuns.id });
  return run!.id;
}

/* ------------------------------ Hulpteksten ------------------------------ */

export function dossierToText(d: Dossier): string {
  const lines: string[] = [];
  for (const key of TEXT_MODULES) {
    const m = d.modules[key];
    if (!m.conclusie && m.bevindingen.length === 0) continue;
    lines.push(`## ${RESEARCH_MODULES.find((x) => x.key === key)!.title}`);
    if (m.conclusie) lines.push(m.conclusie);
    for (const f of m.bevindingen) lines.push(`- [${f.soort}, ${f.betrouwbaarheid}] ${f.tekst}${f.bron ? ` (bron: ${f.bron})` : ""}`);
    if (m.ontbreekt.length) lines.push(`Ontbreekt: ${m.ontbreekt.join("; ")}`);
    lines.push("");
  }
  if (d.kanalen.length) {
    lines.push("## Kanalen");
    for (const k of d.kanalen) lines.push(`- ${platformLabel(k.platform)}: ${k.gevonden ? k.url : "niet gevonden"}${k.volgers !== null ? `, ${k.volgers} volgers (openbaar)` : ""}${k.frequentie ? `, ${k.frequentie}` : ""}`);
    lines.push("");
  }
  if (d.concurrenten.length) {
    lines.push("## Concurrenten");
    for (const c of d.concurrenten) lines.push(`- ${c.naam}: ${c.aanpak} Wat werkt: ${c.watWerkt} Kans: ${c.kansVoorKlant}`);
    lines.push("");
  }
  if (d.software.length) {
    lines.push("## Software");
    for (const s of d.software) lines.push(`- ${s.categorie}: ${s.status === "zichtbaar" ? s.naam : "onbekend"}`);
  }
  return lines.join("\n");
}

export function baselineToText(rows: BaselineRow[]): string {
  return rows
    .map((r) => `- ${platformLabel(r.platform)}, ${r.metric === "anders" ? r.label || "overig" : BASELINE_METRICS[r.metric]}: ${r.value} (${r.herkomst}, ${r.bron}, ${r.gemetenOp})`)
    .join("\n");
}

/** Openbare volgersaantallen uit het dossier als nulmetingsregels. */
function publicBaseline(d: Dossier, today: string): BaselineRow[] {
  return d.kanalen
    .filter((k) => k.gevonden && k.volgers !== null)
    .map((k) => ({
      id: `openbaar-${k.platform}-volgers`,
      platform: k.platform,
      metric: "volgers" as const,
      value: k.volgers!,
      herkomst: "openbaar" as const,
      bron: k.url ?? "Openbaar profiel",
      gemetenOp: today,
    }));
}

/* --------------------------------- Fases --------------------------------- */

type PhaseOutcome = { ok: true } | { ok: false; error: string; fatal?: boolean };

async function phaseIntern(run: Run): Promise<PhaseOutcome> {
  const data = await collectInternal(run.clientId);
  if (!data) return { ok: false, error: "Klant niet gevonden.", fatal: true };
  const today = todayAmsterdam();
  const linked = await linkedBaseline(run.clientId, today);
  // Handmatige cijfers die het team al invoerde blijven staan.
  const manual = ((run.baseline as BaselineRow[]) ?? []).filter((r) => r.herkomst === "handmatig");
  await beat(run.id, {
    internal: data as unknown as Record<string, unknown>,
    baseline: [...linked, ...manual] as unknown as Record<string, unknown>,
    dataBasis: { ...basisOf(data, linked.length), onderzoeksdatum: today, concurrentenBekend: data.concurrenten.length } as Record<string, unknown>,
  });
  return { ok: true };
}

async function phaseWeb(run: Run, which: "bedrijf" | "social"): Promise<PhaseOutcome> {
  const data = run.internal as unknown as InternalData;
  const today = todayAmsterdam();
  const internalText = internalToText(data);
  const res =
    which === "bedrijf"
      ? await runResearch({ system: COMPANY_RESEARCH_SYSTEM, user: companyResearchUser({ internalText, today }), maxUses: 10, maxTokens: 10000 })
      : await runResearch({ system: SOCIAL_RESEARCH_SYSTEM, user: socialResearchUser({ internalText, competitorsText: competitorsToText(data), today }), maxUses: 12, maxTokens: 10000 });
  if (!res.ok) return { ok: false, error: res.reason === "no_provider" ? NO_PROVIDER_MESSAGE : res.error ?? "Webonderzoek mislukt.", fatal: res.reason === "no_provider" };
  if (res.text.length < 200) return { ok: false, error: "Het webonderzoek leverde geen bruikbare briefing op." };
  await beat(run.id, which === "bedrijf" ? { briefingCompany: res.text } : { briefingSocial: res.text });
  return { ok: true };
}

async function previousApproved(run: Run): Promise<{ first: Run | null; last: Run | null }> {
  const rows = await db
    .select()
    .from(clientResearchRuns)
    .where(and(eq(clientResearchRuns.clientId, run.clientId), eq(clientResearchRuns.status, "goedgekeurd"), isNull(clientResearchRuns.deletedAt)))
    .orderBy(asc(clientResearchRuns.createdAt));
  const earlier = rows.filter((r) => r.id !== run.id);
  return { first: earlier[0] ?? null, last: earlier[earlier.length - 1] ?? null };
}

async function phaseDossier(run: Run): Promise<PhaseOutcome> {
  const data = run.internal as unknown as InternalData;
  const prev = run.kind === "hercontrole" ? await previousApproved(run) : { first: null, last: null };
  const input = {
    system: DOSSIER_SYSTEM,
    user: dossierUser({
      clientName: data.clientName,
      internalText: internalToText(data),
      briefingCompany: run.briefingCompany ?? "",
      briefingSocial: run.briefingSocial ?? "",
      previousText: prev.last?.dossier ? dossierToText(prev.last.dossier as Dossier) : "",
    }),
    maxTokens: 20000,
  };
  type Raw = Record<string, unknown> & { wijzigingen?: unknown; bronnen?: unknown };
  let res = await runStructured<Raw>({ ...input, schema: DOSSIER_SCHEMA, effort: "medium" });
  // Vangnet: weigert de API het schema, dan dezelfde opdracht als gewone JSON.
  if (!res.ok && res.reason !== "no_provider" && !isCreditError(res.error)) {
    res = await runJsonPrompt<Raw>({ ...input, user: `${input.user}\n\nGeef UITSLUITEND geldige JSON met de sleutels: modules (per module conclusie, bevindingen[{tekst, soort, betrouwbaarheid, bron, bronUrl}], ontbreekt[]), kanalen[], concurrenten[], software[], wijzigingen[], bronnen[{label, url}].` });
  }
  if (!res.ok) return { ok: false, error: res.reason === "no_provider" ? NO_PROVIDER_MESSAGE : res.error ?? "Dossier opbouwen mislukt.", fatal: res.reason === "no_provider" };

  const dossier = normalizeDossier(res.data);
  const sources: ResearchSource[] = normalizeSources(res.data.bronnen);
  const today = todayAmsterdam();
  const kept = ((run.baseline as BaselineRow[]) ?? []).filter((r) => r.herkomst !== "openbaar");
  const baseline = [...publicBaseline(dossier, today), ...kept];
  const inhoud = Array.isArray(res.data.wijzigingen)
    ? res.data.wijzigingen.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 300)).slice(0, 12)
    : [];
  const changes: ResearchChanges = {
    cijfers: prev.first ? compareBaselines((prev.first.baseline as BaselineRow[]) ?? [], baseline) : [],
    inhoud: run.kind === "hercontrole" ? inhoud : [],
  };
  await beat(run.id, {
    dossier: dossier as unknown as Record<string, unknown>,
    sources: sources as unknown as Record<string, unknown>,
    baseline: baseline as unknown as Record<string, unknown>,
    changes: changes as unknown as Record<string, unknown>,
  });
  return { ok: true };
}

async function phaseStrategie(run: Run): Promise<PhaseOutcome> {
  const data = run.internal as unknown as InternalData;
  const dossier = run.dossier as Dossier | null;
  if (!dossier) return { ok: false, error: "Het dossier ontbreekt." };
  type Raw = { kansen?: unknown; strategieModule?: unknown; strategie?: unknown; topInzichten?: unknown; topKansen?: unknown };
  const input = {
    system: STRATEGY_SYSTEM,
    user: strategyUser({
      clientName: data.clientName,
      internalText: internalToText(data),
      dossierText: dossierToText(dossier),
      baselineText: baselineToText((run.baseline as BaselineRow[]) ?? []),
    }),
    model: aiModelStrong(),
    maxTokens: 12000,
  };
  let res = await runStructured<Raw>({ ...input, schema: STRATEGY_SCHEMA, effort: "medium" });
  if (!res.ok && res.reason !== "no_provider" && !isCreditError(res.error)) {
    res = await runJsonPrompt<Raw>({ ...input, user: `${input.user}\n\nGeef UITSLUITEND geldige JSON met de sleutels: kansen, strategieModule (elk met conclusie, bevindingen[{tekst, soort, betrouwbaarheid, bron, bronUrl}], ontbreekt[]), strategie {pijlers[{naam, waarom}], formats[{naam, waarom}], hooks[], scriptideeen[{titel, hook, kern}], opnames[], verbeterpunten[]}, topInzichten[], topKansen[].` });
  }
  if (!res.ok) return { ok: false, error: res.reason === "no_provider" ? NO_PROVIDER_MESSAGE : res.error ?? "Strategie uitwerken mislukt.", fatal: res.reason === "no_provider" };

  const merged = normalizeDossier({
    ...dossier,
    modules: { ...dossier.modules, kansen: res.data.kansen, strategie: res.data.strategieModule },
    strategie: res.data.strategie,
    topInzichten: res.data.topInzichten,
    topKansen: res.data.topKansen,
  });
  await beat(run.id, { dossier: merged as unknown as Record<string, unknown> });
  return { ok: true };
}

async function finish(run: Run) {
  await db
    .update(clientResearchRuns)
    .set({ status: "controle", phase: "klaar", finishedAt: new Date(), errorMessage: null, heartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(clientResearchRuns.id, run.id));

  const [client] = await db
    .select({ name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId })
    .from(clients)
    .where(eq(clients.id, run.clientId))
    .limit(1);
  if (!client) return;
  const title = run.kind === "hercontrole" ? `Hercontrole klantonderzoek ${client.name} staat klaar` : `Klantonderzoek ${client.name} staat klaar voor controle`;
  await recordActivity({ clientId: run.clientId, type: "client_research.ready", title, entityType: "client_research", entityId: run.id }).catch(() => undefined);
  // Eén melding, alleen naar de verantwoordelijke van deze klant (zonder
  // verantwoordelijke naar de eigenaar). Bewust geen taak erbij.
  await notify({
    ...(client.coordinatorId ? { userIds: [client.coordinatorId] } : { roles: ["owner"] }),
    clientId: run.clientId,
    type: "client_research.ready",
    level: "info",
    title,
    body: "Controleer de bevindingen, corrigeer waar nodig en keur het dossier goed. Pas daarna wordt het gekoppeld aan het Contentgeheugen.",
    href: `/clients/${client.slug}?tab=onderzoek`,
    entityType: "client_research",
    entityId: run.id,
    dedupeKey: `client_research.ready:${run.id}`,
  }).catch((e) => console.error("[client_research.notify]", e));
}

async function fail(runId: string, message: string) {
  const [run] = await db
    .update(clientResearchRuns)
    .set({ status: "mislukt", errorMessage: message.slice(0, 600), finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(clientResearchRuns.id, runId))
    .returning({ clientId: clientResearchRuns.clientId, triggeredById: clientResearchRuns.triggeredById });
  // Een automatisch gestart onderzoek dat strandt, mag niet ongemerkt blijven
  // liggen. Wie het zelf startte, ziet de fout direct op de pagina.
  if (!run || run.triggeredById) return;
  const [client] = await db.select({ name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, run.clientId)).limit(1);
  if (!client) return;
  await notify({
    ...(client.coordinatorId ? { userIds: [client.coordinatorId] } : { roles: ["owner"] }),
    clientId: run.clientId,
    type: "client_research.failed",
    level: "warning",
    title: `Klantonderzoek ${client.name} is niet gelukt`,
    body: `${message.slice(0, 200)} Start het onderzoek opnieuw vanaf de klantpagina.`,
    href: `/clients/${client.slug}?tab=onderzoek`,
    entityType: "client_research",
    entityId: runId,
    dedupeKey: `client_research.failed:${runId}`,
  }).catch((e) => console.error("[client_research.notify]", e));
}

/**
 * Draait zoveel fases als binnen het tijdsbudget passen. Veilig om vaker aan
 * te roepen: een afgeronde of mislukte ronde doet niets meer.
 */
export async function runClientResearchJob(runId: string, opts: { budgetMs?: number } = {}): Promise<JobResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 250_000);
  for (let guard = 0; guard < RESEARCH_PHASES.length + 1; guard++) {
    const [run] = await db.select().from(clientResearchRuns).where(eq(clientResearchRuns.id, runId)).limit(1);
    if (!run || run.status !== "bezig") return { ok: false, reason: "not_running" };
    const phase = resumePhase(run.phase);
    if (phase !== "intern" && !aiConfigured()) {
      await fail(runId, NO_PROVIDER_MESSAGE);
      return { ok: false, phase, reason: "no_provider" };
    }
    if (Date.now() + PHASE_MS[phase] > deadline && guard > 0) {
      await beat(runId, { phase: `wacht_${phase}` });
      await kickClientResearch();
      return { ok: true, phase: `wacht_${phase}` };
    }

    await beat(runId, { phase });
    let outcome: PhaseOutcome;
    try {
      outcome =
        phase === "intern" ? await phaseIntern(run)
        : phase === "bedrijf" ? await phaseWeb(run, "bedrijf")
        : phase === "social" ? await phaseWeb(run, "social")
        : phase === "dossier" ? await phaseDossier(run)
        : await phaseStrategie(run);
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    if (!outcome.ok) {
      const attempts = run.attempts + 1;
      if (isCreditError(outcome.error)) {
        await fail(runId, CREDIT_MESSAGE);
        return { ok: false, phase, reason: "credit" };
      }
      if (outcome.fatal || attempts >= MAX_ATTEMPTS) {
        await fail(runId, outcome.error);
        return { ok: false, phase, reason: outcome.error };
      }
      // Opnieuw proberen in een volgende aanroep.
      await beat(runId, { phase: `wacht_${phase}`, attempts, errorMessage: outcome.error.slice(0, 600) });
      return { ok: false, phase: `wacht_${phase}`, reason: outcome.error };
    }

    const next = RESEARCH_PHASES[RESEARCH_PHASES.indexOf(phase) + 1];
    if (!next) {
      const [fresh] = await db.select().from(clientResearchRuns).where(eq(clientResearchRuns.id, runId)).limit(1);
      await finish(fresh ?? run);
      return { ok: true, phase: "klaar" };
    }
    await beat(runId, { phase: `wacht_${next}`, attempts: 0, errorMessage: null });
  }
  return { ok: true, phase: "wacht" };
}

/**
 * Start de volgende fase in een NIEUWE serverless-aanroep (eigen 5 minuten),
 * zodat een handmatig gestart onderzoek niet op de cron hoeft te wachten.
 * Lukt dat niet, dan pakt de cron het vanzelf op.
 */
export async function kickClientResearch(): Promise<void> {
  if (!env.CRON_SECRET || !env.APP_URL || env.APP_URL.includes("localhost")) return;
  try {
    await fetch(`${env.APP_URL}/api/jobs/run?job=client_research.advance`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    /* time-out is verwacht: de aanroep draait door, of de cron pakt het op */
  }
}

/** Is er in de afgelopen uren een onderzoek gestrand op het AI-tegoed? */
export async function researchCreditBlocked(hours = 3): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clientResearchRuns)
    .where(and(eq(clientResearchRuns.status, "mislukt"), sql`${clientResearchRuns.finishedAt} > now() - (${hours} || ' hours')::interval`, sql`${clientResearchRuns.errorMessage} ilike '%tegoed%'`));
  return (row?.n ?? 0) > 0;
}
