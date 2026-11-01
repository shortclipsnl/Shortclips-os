"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, monthlyReportVersions, tasks, users } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { aiConfigured, runPrompt } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import { auditLog, recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { ensureMonthlyReport } from "@/server/reports/run";
import { currentMonthPeriod, previousMonthPeriod, periodLabel } from "@/server/reports/analysis";
import { checkReportQuality, canApprove, type Beoordeling } from "@/server/reports/quality";
import { saveStrategyProfile } from "@/server/reports/strategy";

export type ActionResult = { ok: boolean; message?: string };

function guard<T>(fn: () => Promise<T>): Promise<T | ActionResult> {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

async function loadReportClient(reportId: string) {
  const [row] = await db
    .select({ id: clientReports.id, clientId: clientReports.clientId, status: clientReports.status, slug: clients.slug, clientName: clients.name, period: clientReports.period })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .where(and(eq(clientReports.id, reportId), isNull(clientReports.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Start (of herstart) de maandanalyse voor een klant. mode: ai_only | full. */
export async function startMonthlyReport(clientId: string, period?: string, mode: "ai_only" | "full" = "ai_only"): Promise<ActionResult & { reportId?: string }> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    assertClientAccess(viewer, clientId);
    if (!aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld (ANTHROPIC_API_KEY)." };
    // Standaard de vorige kalendermaand (het rapport gaat over de afgelopen maand).
    const p = period ?? previousMonthPeriod(currentMonthPeriod());
    const now = new Date();
    // Rij vast klaarzetten zodat de UI meteen status 'analyse_bezig' toont.
    const [existing] = await db.select({ id: clientReports.id }).from(clientReports).where(and(eq(clientReports.clientId, clientId), eq(clientReports.period, p), eq(clientReports.periodType, "month"))).limit(1);
    let reportId = existing?.id;
    if (!reportId) {
      const [created] = await db.insert(clientReports).values({ clientId, periodType: "month", period: p, title: `Maandrapport ${periodLabel(p)}`, status: "analyse_bezig", startedAt: now, generatedById: viewer.id }).returning({ id: clientReports.id });
      reportId = created!.id;
    } else {
      await db.update(clientReports).set({ status: "analyse_bezig", startedAt: now, updatedAt: now }).where(eq(clientReports.id, reportId));
    }
    after(async () => {
      try { await ensureMonthlyReport(clientId, p, { force: true, triggeredById: viewer.id, mode }); } catch { /* status blijft bezig → cron pikt op */ }
    });
    await auditLog({ viewer, action: "report.generate_started", entityType: "client_report", entityId: reportId, clientId });
    revalidatePath("/analytics/maandrapportages");
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    return { ok: true, reportId };
  });
}

/** Bewerkte AI-analyse opslaan. */
export async function saveReportAnalysis(reportId: string, analysis: unknown): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const row = await loadReportClient(reportId);
    if (!row) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, row.clientId);
    await db.update(clientReports).set({ analysis: analysis as Record<string, unknown>, reviewedById: viewer.id, updatedAt: new Date() }).where(eq(clientReports.id, reportId));
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    return { ok: true };
  });
}

/** Persoonlijke beoordeling (3 vragen + eventueel klanttekst) opslaan. */
export async function saveReportBeoordeling(reportId: string, beoordeling: Beoordeling): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const row = await loadReportClient(reportId);
    if (!row) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, row.clientId);
    const clean: Beoordeling = {
      positief: (beoordeling.positief ?? "").slice(0, 2000),
      verbeteren: (beoordeling.verbeteren ?? "").slice(0, 2000),
      volgendeMaand: (beoordeling.volgendeMaand ?? "").slice(0, 2000),
      klanttekst: (beoordeling.klanttekst ?? "").slice(0, 4000),
    };
    await db.update(clientReports).set({ beoordeling: clean as unknown as Record<string, unknown>, reviewedById: viewer.id, updatedAt: new Date() }).where(eq(clientReports.id, reportId));
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    return { ok: true };
  });
}

const PERSONAL_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je schrijft een korte, persoonlijke klanttekst voor een maandrapportage, op basis van de 3 antwoorden die een Shortclips-medewerker invulde. Shortclips-stijl: persoonlijk, positief, zelfverzekerd, resultaatgericht, concreet, begrijpelijk, niet overdreven formeel, geen marketingtermen, geen lange zinnen. Schrijf waar passend vanuit "wij". VOEG GEEN feiten of cijfers toe die niet in de antwoorden staan en verander de mening van de medewerker niet. Geef alleen de tekst terug, zonder kopjes of opmaak.`;

/** "Maak persoonlijke klanttekst": zet de 3 antwoorden om in Shortclips-stijl. */
export async function generatePersonalText(reportId: string): Promise<ActionResult & { text?: string }> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const [row] = await db.select({ clientId: clientReports.clientId, beoordeling: clientReports.beoordeling, clientName: clients.name }).from(clientReports).innerJoin(clients, eq(clients.id, clientReports.clientId)).where(eq(clientReports.id, reportId)).limit(1);
    if (!row) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, row.clientId);
    if (!aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld." };
    const b = (row.beoordeling ?? {}) as Beoordeling;
    if (!((b.positief ?? "").trim() || (b.verbeteren ?? "").trim() || (b.volgendeMaand ?? "").trim())) return { ok: false, message: "Vul eerst de drie beoordelingsvragen in." };
    const res = await runPrompt({
      system: PERSONAL_SYSTEM,
      user: `Klant: ${row.clientName}\n\n1) Wat viel ons deze maand positief op?\n${b.positief ?? ""}\n\n2) Wat willen we verbeteren?\n${b.verbeteren ?? ""}\n\n3) Wat gaan we volgende maand concreet doen?\n${b.volgendeMaand ?? ""}`,
      maxTokens: 900,
    });
    if (!res.ok) return { ok: false, message: "Tekst maken mislukt. Probeer het nog eens." };
    const text = res.text.trim();
    await db.update(clientReports).set({ beoordeling: { ...b, klanttekst: text } as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(clientReports.id, reportId));
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    return { ok: true, text };
  });
}

/** Rapport goedkeuren (alleen als de verplichte kwaliteitspunten af zijn). */
export async function approveMonthlyReport(reportId: string): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const [r] = await db.select().from(clientReports).where(eq(clientReports.id, reportId)).limit(1);
    if (!r) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, r.clientId);
    const issues = checkReportQuality({
      clientName: "",
      analysis: r.analysis as never,
      beoordeling: (r.beoordeling ?? {}) as Beoordeling,
      metrics: (r.metrics ?? {}) as never,
      ontbrekendeGegevens: Array.isArray(r.ontbrekendeGegevens) ? (r.ontbrekendeGegevens as string[]) : [],
    });
    if (!canApprove(issues)) return { ok: false, message: "Nog niet alle verplichte controlepunten zijn afgerond." };
    await db.update(clientReports).set({ status: "goedgekeurd", approvedById: viewer.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(clientReports.id, reportId));
    await auditLog({ viewer, action: "report.approved", entityType: "client_report", entityId: reportId, clientId: r.clientId });
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    revalidatePath("/analytics/maandrapportages");
    return { ok: true };
  });
}

/** Terug naar 'aanpassing nodig' (of concept). */
export async function requestReportChanges(reportId: string): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const row = await loadReportClient(reportId);
    if (!row) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, row.clientId);
    await db.update(clientReports).set({ status: "aanpassing_nodig", updatedAt: new Date() }).where(eq(clientReports.id, reportId));
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    return { ok: true };
  });
}

/** Goedgekeurd rapport publiceren naar het klantportaal (+ klant notificeren). */
export async function publishMonthlyReport(reportId: string): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const [r] = await db.select().from(clientReports).where(eq(clientReports.id, reportId)).limit(1);
    if (!r) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, r.clientId);
    if (r.status !== "goedgekeurd" && r.status !== "gepubliceerd") return { ok: false, message: "Keur het rapport eerst goed." };

    // Versiesnapshot (traceerbaarheid; latere wijziging = nieuwe versie).
    const [last] = await db.select({ n: monthlyReportVersions.versionNumber }).from(monthlyReportVersions).where(eq(monthlyReportVersions.reportId, reportId)).orderBy(desc(monthlyReportVersions.versionNumber)).limit(1);
    await db.insert(monthlyReportVersions).values({
      reportId,
      versionNumber: (last?.n ?? 0) + 1,
      content: { analysis: r.analysis, beoordeling: r.beoordeling, strategischeActies: r.strategischeActies, aandachtspunten: r.aandachtspunten } as unknown as Record<string, unknown>,
      approvedById: viewer.id,
    });

    await db.update(clientReports).set({ status: "gepubliceerd", isPublished: true, publishedAt: new Date(), updatedAt: new Date() }).where(eq(clientReports.id, reportId));

    // Controletaak sluiten.
    await db.update(tasks).set({ status: "done", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(tasks.dedupeKey, `report_review:${reportId}`), isNull(tasks.deletedAt))).catch(() => undefined);

    // Alleen de portaalgebruikers van DEZE klant notificeren (niet alle klanten).
    const portalUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.clientId, r.clientId), eq(users.primaryRole, "client"), eq(users.status, "active")));
    if (portalUsers.length) {
      await notify({
        userIds: portalUsers.map((u) => u.id),
        clientId: r.clientId,
        type: "report_published",
        level: "success",
        title: "Jullie maandanalyse staat klaar!",
        body: `We hebben de resultaten over ${periodLabel(r.period)} bekeken en onze belangrijkste inzichten en verbeterpunten toegevoegd.`,
        href: "/portal/analyses",
        entityType: "client_report",
        entityId: reportId,
        dedupeKey: `report_published:${reportId}`,
      }).catch(() => undefined);
    }

    await auditLog({ viewer, action: "report.published", entityType: "client_report", entityId: reportId, clientId: r.clientId });
    await recordActivity({ clientId: r.clientId, type: "report.published", title: `Maandrapportage ${periodLabel(r.period)} gepubliceerd`, isClientVisible: true }).catch(() => undefined);
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    revalidatePath("/analytics/maandrapportages");
    return { ok: true };
  });
}

/** Publicatie terugtrekken. */
export async function unpublishMonthlyReport(reportId: string): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const row = await loadReportClient(reportId);
    if (!row) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, row.clientId);
    await db.update(clientReports).set({ status: "goedgekeurd", isPublished: false, publishedAt: null, updatedAt: new Date() }).where(eq(clientReports.id, reportId));
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    return { ok: true };
  });
}

/** Strategieprofiel van een klant opslaan (doel-weging voor de analyse). */
export async function saveClientStrategy(input: { clientId: string; primaryGoal: string | null; secondaryGoals: string[]; strategyNote: string }): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    assertClientAccess(viewer, input.clientId);
    await saveStrategyProfile({ clientId: input.clientId, primaryGoal: input.primaryGoal, secondaryGoals: input.secondaryGoals.slice(0, 6), strategyNote: input.strategyNote.slice(0, 2000), updatedById: viewer.id });
    revalidatePath(`/clients`);
    return { ok: true };
  });
}
