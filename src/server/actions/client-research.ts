"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientResearchRuns, clients } from "@/db/schema";
import {
  ForbiddenError,
  assertClientAccess,
  isEditorRole,
  isFreelanceVideographer,
  requireInternal,
  type Viewer,
} from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { aiConfigured } from "@/server/ai/client";
import { todayAmsterdam } from "@/lib/planning-deadline";
import {
  BASELINE_METRICS,
  RESEARCH_MODULES,
  type Addition,
  type BaselineMetric,
  type BaselineRow,
  type Corrections,
  type Dossier,
  type ModuleKey,
} from "@/lib/client-research";
import { approveResearch, resyncApprovedKnowledge } from "@/server/client-research/approve";
import { hasActiveResearch, kickClientResearch, runClientResearchJob, startClientResearch } from "@/server/client-research/run";

export type ActionResult = { ok: boolean; message?: string };

/**
 * Klantonderzoek is uitsluitend voor het interne team. Freelance editors en
 * freelance videografen komen er niet in, ook niet via een directe aanroep.
 * `need` bepaalt wat iemand mag: onderzoek starten of het dossier beheren.
 */
async function requireResearchAccess(need: "start" | "manage"): Promise<Viewer> {
  const viewer = await requireInternal();
  if (isEditorRole(viewer) || isFreelanceVideographer(viewer)) throw new ForbiddenError("Klantonderzoek is alleen voor het interne team.");
  const ok = need === "start"
    ? viewer.permissions.has("content_research:write") || viewer.permissions.has("clients:write")
    : viewer.permissions.has("knowledge:write");
  if (!ok) throw new ForbiddenError("Je hebt geen rechten om dit te doen.");
  return viewer;
}

async function loadRun(viewer: Viewer, runId: string) {
  const [row] = await db
    .select({ run: clientResearchRuns, slug: clients.slug, name: clients.name })
    .from(clientResearchRuns)
    .innerJoin(clients, eq(clients.id, clientResearchRuns.clientId))
    .where(and(eq(clientResearchRuns.id, runId), isNull(clientResearchRuns.deletedAt)))
    .limit(1);
  if (!row) return null;
  assertClientAccess(viewer, row.run.clientId);
  return row;
}

const guard = async (fn: () => Promise<ActionResult>): Promise<ActionResult> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
};

const refresh = (slug: string) => {
  revalidatePath(`/clients/${slug}`);
  revalidatePath("/contentgeheugen");
};

/** Start een onderzoek (nulmeting of hercontrole) of hervat een vastgelopen ronde. */
export async function startClientResearchAction(clientId: string): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requireResearchAccess("start");
    assertClientAccess(viewer, clientId);
    const [c] = await db.select({ slug: clients.slug, status: clients.status }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
    if (!c) return { ok: false, message: "Klant niet gevonden." };
    if (c.status === "paused" || c.status === "churned") return { ok: false, message: "Deze klant is niet actief. Voor niet actieve klanten wordt geen onderzoek gestart." };
    if (!aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld (ANTHROPIC_API_KEY)." };
    if (await hasActiveResearch(clientId)) return { ok: false, message: "Er loopt al een onderzoek voor deze klant." };

    // Een vastgelopen ronde hervatten (de briefings blijven bewaard), anders nieuw.
    const [stuck] = await db
      .select({ id: clientResearchRuns.id })
      .from(clientResearchRuns)
      .where(and(eq(clientResearchRuns.clientId, clientId), eq(clientResearchRuns.status, "bezig"), isNull(clientResearchRuns.deletedAt)))
      .limit(1);
    const runId = stuck?.id ?? (await startClientResearch(clientId, viewer.id));
    // Na de response: alleen de snelle eerste fase hier, de rest in een eigen
    // aanroep (5 minuten per fase). Lukt de doorstart niet, dan pakt de cron het op.
    after(async () => {
      try {
        await runClientResearchJob(runId, { budgetMs: 20_000 });
        await kickClientResearch();
      } catch {
        /* status blijft 'bezig': de cron pakt het op */
      }
    });
    await auditLog({ viewer, action: "client_research.started", entityType: "client_research", entityId: runId, clientId });
    refresh(c.slug);
    return { ok: true };
  });
}

/** Menselijke goedkeuring: koppelt het dossier aan klantkennis en concurrenten. */
export async function approveClientResearchAction(runId: string): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requireResearchAccess("manage");
    const row = await loadRun(viewer, runId);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };
    const res = await approveResearch(runId, { id: viewer.id });
    if (!res.ok) return res;
    await auditLog({ viewer, action: "client_research.approved", entityType: "client_research", entityId: runId, clientId: row.run.clientId, changes: { knowledge: res.knowledge, competitors: res.competitors, nextCheckOn: res.nextCheckOn } });
    await recordActivity({
      clientId: row.run.clientId,
      type: "client_research.approved",
      title: `${row.run.kind === "hercontrole" ? "Hercontrole klantonderzoek" : "Klantonderzoek"} goedgekeurd`,
      entityType: "client_research",
      entityId: runId,
      actor: { id: viewer.id, fullName: viewer.fullName },
    });
    refresh(row.slug);
    return { ok: true, message: `Goedgekeurd. ${res.knowledge} kennisregels gekoppeld${res.competitors ? ` en ${res.competitors} ${res.competitors === 1 ? "concurrent" : "concurrenten"} toegevoegd` : ""}.` };
  });
}

function findingExists(dossier: Dossier | null, findingId: string): boolean {
  if (!dossier) return false;
  return Object.values(dossier.modules).some((m) => m.bevindingen.some((f) => f.id === findingId));
}

/**
 * Correctie op één bevinding: nieuwe tekst, verbergen, of de correctie
 * terugdraaien. Het dossier zelf verandert niet; de correctie staat ernaast.
 */
export async function correctFindingAction(input: { runId: string; findingId: string; tekst?: string; verborgen?: boolean; herstel?: boolean }): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requireResearchAccess("manage");
    const row = await loadRun(viewer, input.runId);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };
    if (!findingExists(row.run.dossier as Dossier | null, input.findingId)) return { ok: false, message: "Bevinding niet gevonden." };

    const corrections = { ...((row.run.corrections ?? {}) as Corrections) };
    if (input.herstel) {
      delete corrections[input.findingId];
    } else {
      const tekst = (input.tekst ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
      if (!input.verborgen && !tekst) return { ok: false, message: "Vul de verbeterde tekst in." };
      corrections[input.findingId] = { ...(tekst ? { tekst } : {}), ...(input.verborgen ? { verborgen: true } : {}), door: viewer.fullName, op: new Date().toISOString() };
    }
    await db.update(clientResearchRuns).set({ corrections, updatedAt: new Date() }).where(eq(clientResearchRuns.id, input.runId));
    await resyncApprovedKnowledge(input.runId, viewer.id);
    await auditLog({ viewer, action: "client_research.corrected", entityType: "client_research", entityId: input.runId, clientId: row.run.clientId, changes: { findingId: input.findingId, verborgen: Boolean(input.verborgen), herstel: Boolean(input.herstel) } });
    refresh(row.slug);
    return { ok: true };
  });
}

/** Aanvulling van het team bij een module (bijv. een bevestigd CRM-systeem). */
export async function addFindingAction(input: { runId: string; module: string; tekst: string }): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requireResearchAccess("manage");
    const row = await loadRun(viewer, input.runId);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };
    if (!RESEARCH_MODULES.some((m) => m.key === input.module)) return { ok: false, message: "Onbekende module." };
    const tekst = input.tekst.replace(/\s+/g, " ").trim().slice(0, 900);
    if (!tekst) return { ok: false, message: "Vul de aanvulling in." };
    const additions = [...((Array.isArray(row.run.additions) ? row.run.additions : []) as Addition[])];
    if (additions.length >= 80) return { ok: false, message: "Het maximum aantal aanvullingen is bereikt." };
    additions.push({ id: randomUUID(), module: input.module as ModuleKey, tekst, door: viewer.fullName, op: new Date().toISOString() });
    await db.update(clientResearchRuns).set({ additions, updatedAt: new Date() }).where(eq(clientResearchRuns.id, input.runId));
    await resyncApprovedKnowledge(input.runId, viewer.id);
    await auditLog({ viewer, action: "client_research.addition", entityType: "client_research", entityId: input.runId, clientId: row.run.clientId, changes: { module: input.module } });
    refresh(row.slug);
    return { ok: true };
  });
}

export async function removeAdditionAction(input: { runId: string; additionId: string }): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requireResearchAccess("manage");
    const row = await loadRun(viewer, input.runId);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };
    const additions = ((Array.isArray(row.run.additions) ? row.run.additions : []) as Addition[]).filter((a) => a.id !== input.additionId);
    await db.update(clientResearchRuns).set({ additions, updatedAt: new Date() }).where(eq(clientResearchRuns.id, input.runId));
    await resyncApprovedKnowledge(input.runId, viewer.id);
    refresh(row.slug);
    return { ok: true };
  });
}

/** Handmatig cijfer voor de nulmeting (bijv. uit de statistieken die de klant deelde). */
export async function addBaselineRowAction(input: { runId: string; platform: string; metric: string; label?: string; value: number; bron: string; gemetenOp?: string }): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requireResearchAccess("manage");
    const row = await loadRun(viewer, input.runId);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };
    if (!(input.metric in BASELINE_METRICS)) return { ok: false, message: "Kies een soort cijfer." };
    const platform = input.platform.trim().toLowerCase().slice(0, 40);
    if (!platform) return { ok: false, message: "Kies een platform." };
    if (!Number.isFinite(input.value) || input.value < 0 || input.value > 1e12) return { ok: false, message: "Vul een geldig getal in." };
    const bron = input.bron.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!bron) return { ok: false, message: "Vermeld waar het cijfer vandaan komt." };
    const label = (input.label ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (input.metric === "anders" && !label) return { ok: false, message: "Geef het cijfer een naam." };
    const gemetenOp = /^\d{4}-\d{2}-\d{2}$/.test(input.gemetenOp ?? "") ? input.gemetenOp! : todayAmsterdam();

    const baseline = [...((Array.isArray(row.run.baseline) ? row.run.baseline : []) as BaselineRow[])];
    if (baseline.filter((b) => b.herkomst === "handmatig").length >= 60) return { ok: false, message: "Het maximum aantal handmatige cijfers is bereikt." };
    baseline.push({ id: `handmatig-${randomUUID()}`, platform, metric: input.metric as BaselineMetric, label: label || null, value: Math.round(input.value), herkomst: "handmatig", bron, gemetenOp, door: viewer.fullName });
    await db.update(clientResearchRuns).set({ baseline, updatedAt: new Date() }).where(eq(clientResearchRuns.id, input.runId));
    await auditLog({ viewer, action: "client_research.baseline_added", entityType: "client_research", entityId: input.runId, clientId: row.run.clientId, changes: { platform, metric: input.metric } });
    refresh(row.slug);
    return { ok: true };
  });
}

/** Alleen handmatig ingevoerde cijfers zijn te verwijderen; gemeten cijfers blijven staan. */
export async function removeBaselineRowAction(input: { runId: string; rowId: string }): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requireResearchAccess("manage");
    const row = await loadRun(viewer, input.runId);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };
    const baseline = ((Array.isArray(row.run.baseline) ? row.run.baseline : []) as BaselineRow[]).filter((b) => !(b.id === input.rowId && b.herkomst === "handmatig"));
    await db.update(clientResearchRuns).set({ baseline, updatedAt: new Date() }).where(eq(clientResearchRuns.id, input.runId));
    refresh(row.slug);
    return { ok: true };
  });
}
