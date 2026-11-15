"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientQuarterSettings, clients, quarterlyImprovements, quarterlyLessons, quarterlyReports, tasks, users } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requireInternal, requirePermission, type Viewer } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { auditLog, recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import {
  EDITABLE_STATUSES, approveBlocker, isQuarterKey, previousQuarter, quarterFromKey, quarterOf, type QuarterMode, type QuarterStatus,
} from "@/lib/kwartaal";
import { blockingChecks, hasKlantInhoud, normalizeIntern, normalizeKlant, quarterChecks, type QuarterKlant } from "@/lib/kwartaal-inhoud";
import type { Doel, QuarterMetrics } from "@/server/quarterly/metrics";
import { amsterdamToday, ensureQuarterRow, generateQuarterReport, loadQuarterSettings, logQuarterEvent, snapshotQuarterVersion } from "@/server/quarterly/run";
import { canApproveQuarter, canSeeQuarterReports, isUuid } from "@/server/quarterly/service";
import { runQuarterlyPlanner, syncQuarterlyTasks } from "@/server/quarterly/workflow";

export type QuarterActionResult = { ok: boolean; message?: string; reportId?: string };

const BASE = "/analytics/kwartaalrapportages";

function guard<T extends QuarterActionResult>(fn: () => Promise<T>): Promise<T | QuarterActionResult> {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  });
}

function refresh(reportId?: string) {
  revalidatePath(BASE);
  if (reportId) revalidatePath(`${BASE}/${reportId}`);
  revalidatePath("/tasks");
}

async function load(viewer: Viewer, reportId: string) {
  if (!isUuid(reportId)) return null;
  const [r] = await db.select().from(quarterlyReports).where(and(eq(quarterlyReports.id, reportId), isNull(quarterlyReports.deletedAt))).limit(1);
  if (!r) return null;
  assertClientAccess(viewer, r.clientId);
  return r;
}

const bezig = (r: { startedAt: Date | null }) => Boolean(r.startedAt && Date.now() - r.startedAt.getTime() < 15 * 60000);

/** Planning bijwerken: kwartalen inplannen, taken en statussen gelijkzetten (zelfde als de dagelijkse job). */
export async function planQuarters(): Promise<QuarterActionResult> {
  return guard(async () => {
    await requirePermission("reports:write");
    await runQuarterlyPlanner();
    refresh();
    return { ok: true };
  });
}

/** Rapportage voor een klant klaarzetten: het lopende of het vorige kwartaal. */
export async function createQuarterReport(clientId: string, which: "huidig" | "vorig"): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    if (!isUuid(clientId)) return { ok: false, message: "Klant niet gevonden." };
    assertClientAccess(viewer, clientId);
    const [c] = await db.select({ startedOn: clients.startedOn }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
    if (!c) return { ok: false, message: "Klant niet gevonden." };
    const startedOn = c.startedOn ? String(c.startedOn).slice(0, 10) : null;
    const settings = await loadQuarterSettings(clientId);
    const huidig = quarterOf(settings.mode, startedOn, amsterdamToday());
    const q = which === "huidig" ? huidig : previousQuarter(huidig, startedOn);
    if (!q) return { ok: false, message: "Er is geen eerder kwartaal voor deze klant." };
    if (startedOn && startedOn > q.to) return { ok: false, message: "De samenwerking liep in dat kwartaal nog niet." };
    const row = await ensureQuarterRow(clientId, q);
    await auditLog({ viewer, action: "quarter_report.created", entityType: "quarterly_report", entityId: row.id, clientId });
    refresh(row.id);
    return { ok: true, reportId: row.id };
  });
}

/** Rapportage (opnieuw) genereren. Tijdens het kwartaal een voorlopig concept, daarna de definitieve versie. */
export async function generateQuarter(reportId: string): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    if (!aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld (ANTHROPIC_API_KEY)." };
    if (r.status === "goedgekeurd" || r.status === "gepubliceerd") return { ok: false, message: "Deze rapportage is goedgekeurd. Heropen haar eerst om opnieuw te genereren." };
    if (bezig(r)) return { ok: false, message: "Deze rapportage wordt al gegenereerd. De status werkt vanzelf bij." };
    const now = new Date();
    await db.update(quarterlyReports).set({ startedAt: now, errorMessage: null, attempts: 0, updatedAt: now }).where(eq(quarterlyReports.id, reportId));
    after(async () => {
      try { await generateQuarterReport(reportId, { byId: viewer.id, force: true }); await syncQuarterlyTasks(); } catch { /* de wachtrij pakt een vastgelopen generatie op */ }
    });
    await auditLog({ viewer, action: "quarter_report.generate_started", entityType: "quarterly_report", entityId: reportId, clientId: r.clientId });
    refresh(reportId);
    return { ok: true, reportId };
  });
}

/**
 * Bewust afronden met onvolledige data. Alleen als het kwartaal voorbij is en
 * de cijfers niet compleet binnenkomen. De keuze wordt vastgelegd en staat
 * bovenaan de ontbrekende gegevens van de rapportage.
 */
export async function finishWithIncompleteData(reportId: string, reden: string): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    if (amsterdamToday() <= String(r.periodEnd)) return { ok: false, message: "Het kwartaal loopt nog. Afronden kan pas na de laatste dag." };
    if (r.status === "goedgekeurd" || r.status === "gepubliceerd") return { ok: false, message: "Deze rapportage is al goedgekeurd." };
    const text = reden.trim().slice(0, 1000);
    if (text.length < 10) return { ok: false, message: "Leg kort uit waarom je afrondt zonder de volledige cijfers." };
    if (!aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld." };
    if (bezig(r)) return { ok: false, message: "Deze rapportage wordt al gegenereerd." };
    const now = new Date();
    await db.update(quarterlyReports).set({ startedAt: now, errorMessage: null, attempts: 0, updatedAt: now }).where(eq(quarterlyReports.id, reportId));
    await logQuarterEvent({ reportId, clientId: r.clientId, type: "onvolledige_data_geaccepteerd", byId: viewer.id, note: text });
    after(async () => {
      try { await generateQuarterReport(reportId, { byId: viewer.id, force: true, allowIncomplete: true }); await syncQuarterlyTasks(); } catch { /* blijft zichtbaar als mislukt */ }
    });
    await auditLog({ viewer, action: "quarter_report.incomplete_accepted", entityType: "quarterly_report", entityId: reportId, clientId: r.clientId, changes: { reden: text } });
    refresh(reportId);
    return { ok: true };
  });
}

/** Inhoud van de klantversie en de interne toelichting aanpassen. Na goedkeuring alleen via heropenen. */
export async function saveQuarterContent(reportId: string, input: { klant?: unknown; toelichting?: string }): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    if (!EDITABLE_STATUSES.includes(r.status as QuarterStatus)) return { ok: false, message: "Deze rapportage is goedgekeurd of nog niet gegenereerd. Heropen haar eerst om te wijzigen." };
    const patch: Record<string, unknown> = { updatedAt: new Date(), reviewedAt: null, reviewedById: null };
    if (input.klant !== undefined) patch.klant = normalizeKlant(input.klant);
    if (input.toelichting !== undefined) patch.intern = { ...normalizeIntern(r.intern), toelichting: input.toelichting.slice(0, 4000) };
    await db.update(quarterlyReports).set(patch).where(eq(quarterlyReports.id, reportId));
    await logQuarterEvent({ reportId, clientId: r.clientId, type: "aangepast", byId: viewer.id, note: input.klant !== undefined ? "Klantversie handmatig aangepast." : "Interne toelichting aangepast." });
    after(() => syncQuarterlyTasks().catch(() => undefined));
    refresh(reportId);
    return { ok: true };
  });
}

/** Een controlepunt bevestigen (bijvoorbeeld: dit cijfer klopt, ik heb de bron gecontroleerd). */
export async function confirmQuarterCheck(reportId: string, checkId: string): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    if (!EDITABLE_STATUSES.includes(r.status as QuarterStatus)) return { ok: false, message: "Deze rapportage kan nu niet gewijzigd worden." };
    const intern = normalizeIntern(r.intern);
    const akkoord = new Set(intern.akkoord ?? []);
    akkoord.add(checkId.slice(0, 80));
    await db.update(quarterlyReports).set({ intern: { ...intern, akkoord: [...akkoord] }, updatedAt: new Date() }).where(eq(quarterlyReports.id, reportId));
    await logQuarterEvent({ reportId, clientId: r.clientId, type: "controlepunt_bevestigd", byId: viewer.id, note: checkId });
    refresh(reportId);
    return { ok: true };
  });
}

function checksOf(r: typeof quarterlyReports.$inferSelect) {
  const metrics = r.metrics as unknown as QuarterMetrics;
  const klant = normalizeKlant(r.klant);
  return quarterChecks({
    klant, intern: normalizeIntern(r.intern), metrics,
    conversiesGemeten: metrics?.conversies != null || metrics?.websiteKlikken != null,
    ontbrekend: Array.isArray(r.ontbrekend) ? (r.ontbrekend as string[]) : [],
    dataCompleet: Boolean(metrics?.dataCompleet), dataOverride: Boolean(r.dataOverrideAt),
    openFeedback: Array.isArray(r.openFeedback) ? (r.openFeedback as unknown[]).length : 0,
  });
}

/** De verantwoordelijke rondt de controle af en biedt de rapportage aan ter goedkeuring. */
export async function markQuarterReviewed(reportId: string): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    const blocker = approveBlocker({ status: r.status as QuarterStatus, voorlopig: r.voorlopig, hasAnalysis: hasKlantInhoud(normalizeKlant(r.klant)), bezig: bezig(r) });
    if (blocker) return { ok: false, message: blocker };
    if (blockingChecks(checksOf(r)).length) return { ok: false, message: "Nog niet alle verplichte controlepunten zijn afgerond." };
    const now = new Date();
    await db.update(quarterlyReports).set({ status: "klaar_voor_controle", reviewedAt: now, reviewedById: viewer.id, updatedAt: now }).where(eq(quarterlyReports.id, reportId));
    await logQuarterEvent({ reportId, clientId: r.clientId, type: "controle_afgerond", from: r.status, to: "klaar_voor_controle", byId: viewer.id, note: "Controle afgerond en aangeboden ter goedkeuring." });
    await auditLog({ viewer, action: "quarter_report.reviewed", entityType: "quarterly_report", entityId: reportId, clientId: r.clientId });
    after(() => syncQuarterlyTasks().catch(() => undefined));
    refresh(reportId);
    return { ok: true };
  });
}

/**
 * Afkeuren of heropenen: de rapportage gaat terug naar "Aanpassingen nodig".
 * Een eerdere goedkeuring vervalt, dus daarna is opnieuw controle en
 * goedkeuring nodig. Een gepubliceerde versie blijft in het klantportaal staan
 * tot de nieuwe versie bewust is gepubliceerd. Met `regenerate` wordt de
 * opmerking direct in een nieuwe AI-versie verwerkt.
 */
export async function requestQuarterChanges(reportId: string, feedback: string, regenerate = false): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    const status = r.status as QuarterStatus;
    if (status === "gepland" || status === "in_voorbereiding") return { ok: false, message: "Er is nog geen rapportage om aan te passen." };
    if (bezig(r)) return { ok: false, message: "De rapportage wordt nog gegenereerd. Probeer het zo opnieuw." };
    const text = feedback.trim().slice(0, 4000);
    if ((regenerate || status === "goedgekeurd" || status === "gepubliceerd") && !text) return { ok: false, message: "Schrijf eerst wat er aangepast moet worden." };
    if (regenerate && !aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld." };
    const open = (Array.isArray(r.openFeedback) ? r.openFeedback : []) as Array<Record<string, unknown>>;
    if (text) open.push({ id: crypto.randomUUID(), body: text, byName: viewer.fullName, at: new Date().toISOString() });
    // Een voorlopig concept blijft een concept; een definitieve rapportage gaat terug naar aanpassen.
    const next: QuarterStatus = r.voorlopig ? status : "aanpassingen_nodig";
    const now = new Date();
    await db.update(quarterlyReports).set({
      status: next, openFeedback: open, reviewedAt: null, reviewedById: null, approvedAt: null, approvedById: null, approvedVersion: null,
      ...(regenerate ? { startedAt: now, errorMessage: null, attempts: 0 } : {}), updatedAt: now,
    }).where(eq(quarterlyReports.id, reportId));
    const heropend = status === "goedgekeurd" || status === "gepubliceerd";
    await logQuarterEvent({
      reportId, clientId: r.clientId, type: heropend ? "heropend" : "aanpassingen_gevraagd", from: status, to: next, byId: viewer.id,
      note: text || "Teruggezet voor aanpassing.", meta: { regenerate, publishedVersion: r.publishedVersion },
    });
    await auditLog({ viewer, action: heropend ? "quarter_report.reopened" : "quarter_report.changes_requested", entityType: "quarterly_report", entityId: reportId, clientId: r.clientId });
    after(async () => {
      try { if (regenerate) await generateQuarterReport(reportId, { byId: viewer.id, force: true }); } catch { /* blijft zichtbaar als mislukt */ }
      await syncQuarterlyTasks().catch(() => undefined);
    });
    refresh(reportId);
    return { ok: true };
  });
}

/** Opmerkingen handmatig verwerkt: de rapportage gaat terug naar de controle. */
export async function resolveQuarterFeedback(reportId: string): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    if (!EDITABLE_STATUSES.includes(r.status as QuarterStatus)) return { ok: false, message: "Deze rapportage kan nu niet gewijzigd worden." };
    const aantal = Array.isArray(r.openFeedback) ? (r.openFeedback as unknown[]).length : 0;
    const next: QuarterStatus = r.status === "aanpassingen_nodig" ? "klaar_voor_controle" : (r.status as QuarterStatus);
    await db.update(quarterlyReports).set({ openFeedback: [], status: next, updatedAt: new Date() }).where(eq(quarterlyReports.id, reportId));
    await logQuarterEvent({ reportId, clientId: r.clientId, type: "opmerkingen_verwerkt", from: r.status, to: next, byId: viewer.id, note: `${aantal} opmerking(en) handmatig verwerkt.` });
    after(() => syncQuarterlyTasks().catch(() => undefined));
    refresh(reportId);
    return { ok: true };
  });
}

/** Lessen en verbeterpunten vastleggen zodra een mens de rapportage heeft goedgekeurd. */
async function saveLessonsAndImprovements(r: typeof quarterlyReports.$inferSelect, klant: QuarterKlant, periodLabel: string): Promise<void> {
  const g = klant.geleerd;
  const lessons: Array<{ kind: string; text: string; zekerheid: string }> = [
    ...g.vaker.map((t) => ({ kind: "vaker", text: t, zekerheid: "waarschijnlijk" })),
    ...g.minder.map((t) => ({ kind: "minder", text: t, zekerheid: "waarschijnlijk" })),
    ...([["onderwerp", g.onderwerpen], ["hook", g.hooks], ["format", g.formats], ["lengte", g.lengtes], ["presentator", g.presentatoren], ["doelgroep", g.doelgroep]] as const)
      .flatMap(([kind, list]) => list.map((i) => ({ kind, text: i.onderbouwing ? `${i.punt} (${i.onderbouwing})` : i.punt, zekerheid: i.zekerheid }))),
  ].filter((l) => l.text.trim());
  // Opnieuw goedkeuren vervangt de eerdere lessen van deze rapportage: nooit dubbel.
  await db.delete(quarterlyLessons).where(eq(quarterlyLessons.reportId, r.id));
  if (lessons.length) {
    await db.insert(quarterlyLessons).values(lessons.map((l) => ({ clientId: r.clientId, reportId: r.id, periodKey: r.periodKey, periodLabel, kind: l.kind, text: l.text.slice(0, 600), zekerheid: l.zekerheid })));
  }
  // Verbeterpunten: bestaande opvolging (status, notitie, taak) behouden als de titel gelijk blijft.
  const bestaand = await db.select().from(quarterlyImprovements).where(eq(quarterlyImprovements.reportId, r.id));
  const byTitel = new Map(bestaand.map((b) => [b.titel, b]));
  const nieuw = klant.verbeterpunten.map((v, i) => ({ titel: v.constatering.slice(0, 240), actie: v.actie, verantwoordelijke: v.verantwoordelijke || null, position: i }));
  const titels = new Set(nieuw.map((n) => n.titel));
  for (const b of bestaand) if (!titels.has(b.titel)) await db.delete(quarterlyImprovements).where(eq(quarterlyImprovements.id, b.id));
  for (const n of nieuw) {
    const b = byTitel.get(n.titel);
    if (b) await db.update(quarterlyImprovements).set({ actie: n.actie, verantwoordelijke: n.verantwoordelijke, position: n.position, updatedAt: new Date() }).where(eq(quarterlyImprovements.id, b.id));
    else await db.insert(quarterlyImprovements).values({ clientId: r.clientId, reportId: r.id, periodKey: r.periodKey, ...n });
  }
  await db.update(quarterlyReports).set({ lessonsSavedAt: new Date() }).where(eq(quarterlyReports.id, r.id));
  await import("@/server/content-memory").then((m) => m.clearContentMemoryCache(r.clientId)).catch(() => undefined);
}

/**
 * Goedkeuren. Alleen door wie daartoe bevoegd is, nooit met voorlopige cijfers
 * en alleen als alle verplichte controlepunten zijn afgerond. De goedgekeurde
 * inhoud wordt als versie vastgelegd; publiceren is een aparte, bewuste stap.
 */
export async function approveQuarter(reportId: string): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    if (!canApproveQuarter(viewer)) return { ok: false, message: "Goedkeuren is voorbehouden aan wie daarvoor bevoegd is. Rond jouw controle af; de goedkeurder krijgt dan automatisch een taak." };
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    const klant = normalizeKlant(r.klant);
    const blocker = approveBlocker({ status: r.status as QuarterStatus, voorlopig: r.voorlopig, hasAnalysis: hasKlantInhoud(klant), bezig: bezig(r) });
    if (blocker) return { ok: false, message: blocker };
    if (blockingChecks(checksOf(r)).length) return { ok: false, message: "Nog niet alle verplichte controlepunten zijn afgerond." };
    const now = new Date();
    await db.update(quarterlyReports).set({
      status: "goedgekeurd", approvedById: viewer.id, approvedAt: now,
      reviewedAt: r.reviewedAt ?? now, reviewedById: r.reviewedById ?? viewer.id, updatedAt: now,
    }).where(eq(quarterlyReports.id, reportId));
    const versie = await snapshotQuarterVersion(reportId, "goedkeuring", viewer.id);
    await db.update(quarterlyReports).set({ approvedVersion: versie }).where(eq(quarterlyReports.id, reportId));
    const [c] = await db.select({ startedOn: clients.startedOn }).from(clients).where(eq(clients.id, r.clientId)).limit(1);
    const q = quarterFromKey(r.periodKey, c?.startedOn ? String(c.startedOn).slice(0, 10) : null);
    await saveLessonsAndImprovements(r, klant, q?.label ?? r.periodKey);
    await logQuarterEvent({ reportId, clientId: r.clientId, type: "goedgekeurd", from: r.status, to: "goedgekeurd", byId: viewer.id, note: `Goedgekeurd (versie ${versie}). Lessen vastgelegd in het Contentgeheugen.`, meta: { versie } });
    await auditLog({ viewer, action: "quarter_report.approved", entityType: "quarterly_report", entityId: reportId, clientId: r.clientId, changes: { versie } });
    after(() => syncQuarterlyTasks().catch(() => undefined));
    refresh(reportId);
    return { ok: true };
  });
}

/**
 * Publiceren naar het klantportaal: de goedgekeurde klantversie wordt als
 * onveranderlijke versie vastgelegd en alleen die versie is zichtbaar voor de
 * klant. Stond er al een versie in het portaal, dan is dit een herpublicatie.
 */
export async function publishQuarter(reportId: string): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    if (r.status !== "goedgekeurd") return { ok: false, message: r.status === "gepubliceerd" ? "Deze rapportage staat al in het klantportaal." : "Keur de rapportage eerst goed." };
    if (r.voorlopig) return { ok: false, message: "Een voorlopig concept kan niet gepubliceerd worden." };
    const her = r.publishedVersion !== null;
    const versie = await snapshotQuarterVersion(reportId, her ? "herpublicatie" : "publicatie", viewer.id, her ? `Vervangt versie ${r.publishedVersion} in het klantportaal` : null);
    const now = new Date();
    await db.update(quarterlyReports).set({ status: "gepubliceerd", publishedVersion: versie, publishedAt: now, publishedById: viewer.id, updatedAt: now }).where(eq(quarterlyReports.id, reportId));
    await logQuarterEvent({ reportId, clientId: r.clientId, type: "gepubliceerd", from: "goedgekeurd", to: "gepubliceerd", byId: viewer.id, note: her ? `Herpublicatie: versie ${versie} vervangt versie ${r.publishedVersion} in het klantportaal.` : `Versie ${versie} gepubliceerd in het klantportaal.`, meta: { versie, vervangt: r.publishedVersion } });
    const portalUsers = await db.select({ id: users.id }).from(users).where(and(eq(users.clientId, r.clientId), eq(users.primaryRole, "client"), eq(users.status, "active")));
    if (portalUsers.length) {
      await notify({
        userIds: portalUsers.map((u) => u.id), clientId: r.clientId, type: "report_published", level: "success",
        title: her ? "Jullie kwartaalrapportage is bijgewerkt" : "Jullie kwartaalrapportage staat klaar!",
        body: `${r.title}: de resultaten van de afgelopen drie maanden, wat we hebben geleerd en het plan voor het komende kwartaal.`,
        href: `/portal/resultaten/kwartaal?rapport=${r.id}`, entityType: "quarterly_report", entityId: r.id, dedupeKey: `quarter_report_published:${r.id}:${versie}`,
      }).catch(() => undefined);
    }
    await auditLog({ viewer, action: her ? "quarter_report.republished" : "quarter_report.published", entityType: "quarterly_report", entityId: reportId, clientId: r.clientId, changes: { versie } });
    await recordActivity({ clientId: r.clientId, type: "quarter_report.published", title: `${r.title} gedeeld`, isClientVisible: true }).catch(() => undefined);
    after(() => syncQuarterlyTasks().catch(() => undefined));
    refresh(reportId);
    return { ok: true };
  });
}

/** Publicatie intrekken: de rapportage verdwijnt uit het klantportaal, de versies blijven bewaard. */
export async function unpublishQuarter(reportId: string): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const r = await load(viewer, reportId);
    if (!r) return { ok: false, message: "Rapportage niet gevonden." };
    if (r.publishedVersion === null) return { ok: false, message: "Deze rapportage staat niet in het klantportaal." };
    const next = r.status === "gepubliceerd" ? "goedgekeurd" : r.status;
    await db.update(quarterlyReports).set({ status: next, publishedVersion: null, publishedAt: null, publishedById: null, updatedAt: new Date() }).where(eq(quarterlyReports.id, reportId));
    await logQuarterEvent({ reportId, clientId: r.clientId, type: "publicatie_ingetrokken", from: r.status, to: next, byId: viewer.id, note: `Versie ${r.publishedVersion} uit het klantportaal gehaald.` });
    await auditLog({ viewer, action: "quarter_report.unpublished", entityType: "quarterly_report", entityId: reportId, clientId: r.clientId });
    after(() => syncQuarterlyTasks().catch(() => undefined));
    refresh(reportId);
    return { ok: true };
  });
}

/** Kwartaalindeling per klant: kalenderkwartalen of contractkwartalen, en aan of uit. */
export async function saveQuarterSettings(clientId: string, input: { mode: QuarterMode; enabled: boolean }): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    if (!isUuid(clientId)) return { ok: false, message: "Klant niet gevonden." };
    assertClientAccess(viewer, clientId);
    const mode: QuarterMode = input.mode === "contract" ? "contract" : "kalender";
    if (mode === "contract") {
      const [c] = await db.select({ startedOn: clients.startedOn }).from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!c?.startedOn) return { ok: false, message: "Vul eerst de startdatum van de samenwerking in bij de klantgegevens. Contractkwartalen rekenen vanaf die datum." };
    }
    await db.insert(clientQuarterSettings).values({ clientId, mode, enabled: input.enabled, updatedById: viewer.id })
      .onConflictDoUpdate({ target: clientQuarterSettings.clientId, set: { mode, enabled: input.enabled, updatedById: viewer.id, updatedAt: new Date() } });
    await auditLog({ viewer, action: "quarter_report.settings", entityType: "client", entityId: clientId, clientId, changes: { mode, enabled: input.enabled } });
    refresh();
    revalidatePath("/clients");
    return { ok: true };
  });
}

const METRICS = ["views", "reach", "engagements", "followerGrowth", "videos", "gemViewsPerVideo", "websiteKlikken", "conversies"];

/** Doelen voor een kwartaal vastleggen (optioneel). Zonder doelen toont de rapportage dat er geen zijn. */
export async function saveQuarterGoals(clientId: string, periodKey: string, doelen: Array<{ label: string; metric: string; target: number }>): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    if (!isUuid(clientId) || !isQuarterKey(periodKey)) return { ok: false, message: "Ongeldige invoer." };
    assertClientAccess(viewer, clientId);
    const clean: Doel[] = doelen
      .filter((d) => METRICS.includes(d.metric) && Number.isFinite(d.target) && d.target > 0)
      .slice(0, 6)
      .map((d) => ({ id: crypto.randomUUID(), label: d.label.trim().slice(0, 120) || d.metric, metric: d.metric, target: Math.round(d.target) }));
    const cur = await loadQuarterSettings(clientId);
    const all = { ...cur.doelen, [periodKey]: clean };
    await db.insert(clientQuarterSettings).values({ clientId, mode: cur.mode, enabled: cur.enabled, doelen: all, updatedById: viewer.id })
      .onConflictDoUpdate({ target: clientQuarterSettings.clientId, set: { doelen: all, updatedById: viewer.id, updatedAt: new Date() } });
    await auditLog({ viewer, action: "quarter_report.goals", entityType: "client", entityId: clientId, clientId, changes: { periodKey, aantal: clean.length } });
    refresh();
    return { ok: true };
  });
}

/** Opvolging van een verbeterpunt: uitgevoerd, vervallen of weer open. */
export async function setImprovementStatus(improvementId: string, status: "open" | "uitgevoerd" | "vervallen", note?: string): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    if (!canSeeQuarterReports(viewer)) return { ok: false, message: "Je hebt geen toegang tot rapportages." };
    if (!isUuid(improvementId)) return { ok: false, message: "Verbeterpunt niet gevonden." };
    const [i] = await db.select().from(quarterlyImprovements).where(eq(quarterlyImprovements.id, improvementId)).limit(1);
    if (!i) return { ok: false, message: "Verbeterpunt niet gevonden." };
    assertClientAccess(viewer, i.clientId);
    const done = status === "uitgevoerd";
    await db.update(quarterlyImprovements).set({ status, note: note !== undefined ? note.slice(0, 1000) : i.note, doneAt: done ? new Date() : null, doneById: done ? viewer.id : null, updatedAt: new Date() }).where(eq(quarterlyImprovements.id, improvementId));
    await logQuarterEvent({ reportId: i.reportId, clientId: i.clientId, type: "verbeterpunt_bijgewerkt", byId: viewer.id, note: `${i.titel}: ${status}` });
    refresh(i.reportId);
    return { ok: true };
  });
}

/** Zet een verbeterpunt om naar een taak op de bestaande takenpagina (één taak per verbeterpunt). */
export async function createImprovementTask(improvementId: string, assigneeId: string | null, dueOn: string | null): Promise<QuarterActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("tasks:write");
    if (!canSeeQuarterReports(viewer)) return { ok: false, message: "Je hebt geen toegang tot rapportages." };
    if (!isUuid(improvementId) || (assigneeId && !isUuid(assigneeId))) return { ok: false, message: "Ongeldige invoer." };
    if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { ok: false, message: "Ongeldige datum." };
    const [i] = await db.select().from(quarterlyImprovements).where(eq(quarterlyImprovements.id, improvementId)).limit(1);
    if (!i) return { ok: false, message: "Verbeterpunt niet gevonden." };
    assertClientAccess(viewer, i.clientId);
    if (i.taskId) return { ok: false, message: "Voor dit verbeterpunt bestaat al een taak." };
    const [created] = await db.insert(tasks).values({
      clientId: i.clientId, title: i.titel.slice(0, 240), description: `Verbeterpunt uit de kwartaalrapportage.\n\n${i.actie}`.slice(0, 4000), category: "overig",
      assigneeId, dueOn, entityType: "quarterly_report", entityId: i.reportId, source: "manual", dedupeKey: `kwartaal_verbeterpunt:${i.id}`, createdById: viewer.id,
    }).onConflictDoNothing().returning({ id: tasks.id });
    if (!created) return { ok: false, message: "Voor dit verbeterpunt bestaat al een taak." };
    await db.update(quarterlyImprovements).set({ taskId: created.id, updatedAt: new Date() }).where(eq(quarterlyImprovements.id, i.id));
    refresh(i.reportId);
    return { ok: true };
  });
}
