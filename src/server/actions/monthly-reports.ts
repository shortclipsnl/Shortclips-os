"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, monthlyReportFeedback, monthlyReportVersions, tasks, users } from "@/db/schema";
import { requirePermission, requireInternal, assertClientAccess, ForbiddenError, isOwner } from "@/server/auth/context";
import { aiConfigured, runPrompt } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import { auditLog, recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { ensureMonthlyReport, snapshotVersion } from "@/server/reports/run";
import { assignReportReaders, markRead, markUnread } from "@/server/reports/team";
import { ACTIVE_CLIENT_STATUSES, APPROVED_STATUSES, canSeeReports, isUuid, type ReportStatus } from "@/server/reports/service";
import { duplicateIssue, findDuplicateMetricClients } from "@/server/reports/metrics";
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
  if (!isUuid(reportId)) return null;
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
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) return { ok: false, message: "Ongeldige maand." };
    if (p >= currentMonthPeriod()) return { ok: false, message: "Een maandrapport kan pas gemaakt worden als de maand voorbij is." };
    const now = new Date();
    // Rij vast klaarzetten zodat de UI meteen status 'analyse_bezig' toont.
    const [existing] = await db.select({ id: clientReports.id, status: clientReports.status, startedAt: clientReports.startedAt, deletedAt: clientReports.deletedAt }).from(clientReports).where(and(eq(clientReports.clientId, clientId), eq(clientReports.period, p), eq(clientReports.periodType, "month"))).limit(1);
    if (existing && APPROVED_STATUSES.includes(existing.status as ReportStatus)) return { ok: false, message: "Dit rapport is al goedgekeurd. Zet het eerst terug naar aanpassen." };
    // Dubbel klikken of twee collega's tegelijk: een lopende generatie niet opnieuw starten.
    if (existing && !existing.deletedAt && existing.status === "analyse_bezig" && existing.startedAt && Date.now() - existing.startedAt.getTime() < 15 * 60000) {
      return { ok: false, message: "Dit rapport wordt al gegenereerd. Even geduld, de status werkt vanzelf bij." };
    }
    let reportId = existing?.id;
    if (!reportId) {
      const [created] = await db.insert(clientReports).values({ clientId, periodType: "month", period: p, title: `Maandrapport ${periodLabel(p)}`, status: "analyse_bezig", startedAt: now, generatedById: viewer.id }).returning({ id: clientReports.id });
      reportId = created!.id;
    } else {
      await db.update(clientReports).set({ status: "analyse_bezig", startedAt: now, updatedAt: now, deletedAt: null }).where(eq(clientReports.id, reportId));
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
    if (APPROVED_STATUSES.includes(row.status as ReportStatus)) return { ok: false, message: "Dit rapport is goedgekeurd. Zet het eerst terug naar aanpassen om te wijzigen." };
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
    if (APPROVED_STATUSES.includes(row.status as ReportStatus)) return { ok: false, message: "Dit rapport is goedgekeurd. Zet het eerst terug naar aanpassen om te wijzigen." };
    const [huidig] = await db.select({ beoordeling: clientReports.beoordeling }).from(clientReports).where(eq(clientReports.id, reportId)).limit(1);
    const verborgen = ((huidig?.beoordeling ?? {}) as Beoordeling).verborgenVideos ?? [];
    const clean: Beoordeling = {
      verborgenVideos: verborgen,
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

/** Een video wel of niet in de klantversie tonen (de interne versie toont altijd alles). */
export async function setReportVideoHidden(reportId: string, videoId: string, hidden: boolean): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const row = await loadReportClient(reportId);
    if (!row) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, row.clientId);
    if (!isUuid(videoId)) return { ok: false, message: "Onbekende video." };
    if (APPROVED_STATUSES.includes(row.status as ReportStatus)) return { ok: false, message: "Dit rapport is goedgekeurd. Zet het eerst terug naar aanpassen om te wijzigen." };
    const [huidig] = await db.select({ beoordeling: clientReports.beoordeling }).from(clientReports).where(eq(clientReports.id, reportId)).limit(1);
    const b = ((huidig?.beoordeling ?? {}) as Beoordeling);
    const set = new Set(b.verborgenVideos ?? []);
    if (hidden) set.add(videoId);
    else set.delete(videoId);
    await db.update(clientReports).set({ beoordeling: { ...b, verborgenVideos: [...set] } as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(clientReports.id, reportId));
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

/**
 * Rapport goedkeuren. Alleen de eigenaar (Jarno) keurt goed, en alleen als de
 * verplichte kwaliteitspunten af zijn. Daarna krijgt het team een leesopdracht.
 * Publiceren naar het klantportaal is een aparte, expliciete stap.
 */
export async function approveMonthlyReport(reportId: string): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    if (!isOwner(viewer)) return { ok: false, message: "Alleen Jarno kan maandrapportages goedkeuren." };
    const [r] = await db.select().from(clientReports).where(and(eq(clientReports.id, reportId), isNull(clientReports.deletedAt))).limit(1);
    if (!r) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, r.clientId);
    if (r.status !== "klaar_voor_controle" && r.status !== "aanpassing_nodig") return { ok: false, message: "Dit rapport kan in deze status niet goedgekeurd worden." };
    const issues = checkReportQuality({
      clientName: "",
      analysis: r.analysis as never,
      beoordeling: (r.beoordeling ?? {}) as Beoordeling,
      metrics: (r.metrics ?? {}) as never,
      ontbrekendeGegevens: Array.isArray(r.ontbrekendeGegevens) ? (r.ontbrekendeGegevens as string[]) : [],
      dubbel: duplicateIssue(await findDuplicateMetricClients(r.clientId, r.period)),
    });
    if (!canApprove(issues)) return { ok: false, message: "Nog niet alle verplichte controlepunten zijn afgerond." };
    const now = new Date();
    await db.update(clientReports).set({ status: "goedgekeurd", approvedById: viewer.id, approvedAt: now, reviewedById: viewer.id, updatedAt: now }).where(eq(clientReports.id, reportId));
    await snapshotVersion(reportId, "goedkeuring", viewer.id);
    // Controletaak is klaar; het team krijgt een leesopdracht.
    await db.update(tasks).set({ status: "done", completedAt: now, updatedAt: now }).where(and(eq(tasks.dedupeKey, `report_review:${reportId}`), isNull(tasks.deletedAt))).catch(() => undefined);
    await assignReportReaders(reportId, viewer.id);
    await auditLog({ viewer, action: "report.approved", entityType: "client_report", entityId: reportId, clientId: r.clientId });
    // Bewust géén automatische publicatie: de klantversie gaat pas naar het
    // klantportaal als een medewerker de publicatie expliciet bevestigt.
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    revalidatePath("/analytics/maandrapportages");
    return { ok: true };
  });
}

/**
 * Aanpassing vragen: optioneel met feedback (blijft bewaard). Met `regenerate`
 * wordt de AI-analyse direct opnieuw opgesteld met de feedback erin verwerkt.
 */
export async function requestReportChanges(reportId: string, feedback?: string, regenerate = false): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const row = await loadReportClient(reportId);
    if (!row) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, row.clientId);
    if (row.status === "gepubliceerd") return { ok: false, message: "Trek de publicatie eerst terug voordat je aanpassingen vraagt." };
    if (row.status === "analyse_bezig") return { ok: false, message: "De analyse wordt nog opgesteld. Probeer het zo opnieuw." };
    const text = (feedback ?? "").trim().slice(0, 4000);
    if (regenerate && !text) return { ok: false, message: "Schrijf eerst wat er aangepast moet worden." };
    if (text) {
      const [last] = await db.select({ n: monthlyReportVersions.versionNumber }).from(monthlyReportVersions).where(eq(monthlyReportVersions.reportId, reportId)).orderBy(desc(monthlyReportVersions.versionNumber)).limit(1);
      await db.insert(monthlyReportFeedback).values({ reportId, authorId: viewer.id, body: text, versionNumber: last?.n ?? null });
    }
    await db.update(clientReports).set({ status: "aanpassing_nodig", updatedAt: new Date() }).where(eq(clientReports.id, reportId));
    await auditLog({ viewer, action: "report.changes_requested", entityType: "client_report", entityId: reportId, clientId: row.clientId });
    if (regenerate) {
      if (!aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld." };
      const now = new Date();
      await db.update(clientReports).set({ status: "analyse_bezig", startedAt: now, updatedAt: now }).where(eq(clientReports.id, reportId));
      after(async () => {
        try { await ensureMonthlyReport(row.clientId, row.period, { force: true, triggeredById: viewer.id, mode: "ai_only" }); } catch { /* cron pikt een vastgelopen analyse op */ }
      });
    }
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    revalidatePath("/analytics/maandrapportages");
    return { ok: true };
  });
}

/**
 * Zet de klantversie in het klantportaal en laat de portaalgebruikers van deze
 * klant weten dat de rapportage klaarstaat. Alleen na expliciete bevestiging
 * door een medewerker (publishMonthlyReport), nooit automatisch.
 */
async function publishToPortal(viewer: Awaited<ReturnType<typeof requirePermission>>, r: { id: string; clientId: string; period: string }): Promise<void> {
  // Versiesnapshot van wat de klant te zien krijgt (traceerbaarheid).
  await snapshotVersion(r.id, "publicatie", viewer.id);
  await db.update(clientReports).set({ status: "gepubliceerd", isPublished: true, publishedAt: new Date(), updatedAt: new Date() }).where(eq(clientReports.id, r.id));
  await db.update(tasks).set({ status: "done", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(tasks.dedupeKey, `report_review:${r.id}`), isNull(tasks.deletedAt))).catch(() => undefined);

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
      title: "Jullie maandrapportage staat klaar!",
      body: `We hebben de resultaten van ${periodLabel(r.period)} op een rij gezet, met de cijfers per platform en per video en onze aanpak voor volgende maand.`,
      href: "/portal/analyses",
      entityType: "client_report",
      entityId: r.id,
      dedupeKey: `report_published:${r.id}`,
    }).catch(() => undefined);
  }
  await auditLog({ viewer, action: "report.published", entityType: "client_report", entityId: r.id, clientId: r.clientId });
  await recordActivity({ clientId: r.clientId, type: "report.published", title: `Maandrapportage ${periodLabel(r.period)} gedeeld`, isClientVisible: true }).catch(() => undefined);
}

/** Goedgekeurd rapport (expliciet bevestigd) publiceren in het klantportaal van de juiste klant. */
export async function publishMonthlyReport(reportId: string): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    const [r] = await db.select().from(clientReports).where(and(eq(clientReports.id, reportId), isNull(clientReports.deletedAt))).limit(1);
    if (!r) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, r.clientId);
    if (r.status !== "goedgekeurd") return { ok: false, message: r.status === "gepubliceerd" ? "Dit rapport is al gedeeld met de klant." : "Keur het rapport eerst goed." };
    await publishToPortal(viewer, r);
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

/**
 * Zet voor alle actieve klanten zonder (gelukt) rapport een rapport in de
 * wachtrij. De wachtrij wordt op de achtergrond verwerkt (job
 * reports.process_queue), zodat er nooit tientallen AI-analyses tegelijk lopen.
 */
export async function queueMonthlyReports(period: string): Promise<ActionResult & { queued?: number }> {
  return guard(async () => {
    const viewer = await requirePermission("reports:write");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { ok: false, message: "Ongeldige maand." };
    if (period >= currentMonthPeriod()) return { ok: false, message: "Een maandrapport kan pas gemaakt worden als de maand voorbij is." };
    if (!aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld (ANTHROPIC_API_KEY)." };
    const active = await db.select({ id: clients.id }).from(clients).where(and(isNull(clients.deletedAt), inArray(clients.status, [...ACTIVE_CLIENT_STATUSES])));
    let queued = 0;
    for (const c of active) {
      if (viewer.clientScope !== null && !viewer.clientScope.includes(c.id)) continue;
      const [existing] = await db.select({ id: clientReports.id, status: clientReports.status, deletedAt: clientReports.deletedAt }).from(clientReports).where(and(eq(clientReports.clientId, c.id), eq(clientReports.period, period), eq(clientReports.periodType, "month"))).limit(1);
      if (!existing) {
        await db.insert(clientReports).values({ clientId: c.id, periodType: "month", period, title: `Maandrapport ${periodLabel(period)}`, status: "gegevens_verzamelen", generatedById: viewer.id }).onConflictDoNothing();
        queued++;
      } else if (existing.status === "mislukt" || existing.deletedAt) {
        await db.update(clientReports).set({ status: "gegevens_verzamelen", errorMessage: null, deletedAt: null, updatedAt: new Date() }).where(eq(clientReports.id, existing.id));
        queued++;
      }
    }
    await auditLog({ viewer, action: "report.queue_month", entityType: "client_report", entityId: undefined, clientId: undefined });
    revalidatePath("/analytics/maandrapportages");
    return { ok: true, queued };
  });
}

/** Markeer een goedgekeurd rapport als doorgenomen (of maak dat ongedaan). */
export async function setReportRead(reportId: string, read: boolean): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    if (!canSeeReports(viewer)) return { ok: false, message: "Je hebt geen toegang tot maandrapportages." };
    const row = await loadReportClient(reportId);
    if (!row) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, row.clientId);
    if (!APPROVED_STATUSES.includes(row.status as ReportStatus)) return { ok: false, message: "Een rapport kan pas doorgenomen worden als het is goedgekeurd." };
    if (read) await markRead(reportId, viewer.id);
    else await markUnread(reportId, viewer.id);
    revalidatePath(`/analytics/maandrapportages/${reportId}`);
    revalidatePath("/analytics/maandrapportages");
    return { ok: true };
  });
}

/**
 * Zet een actiepunt uit het rapport om naar een taak in de bestaande
 * takenstructuur, met verantwoordelijke en eventueel deadline. Eén taak per
 * actiepunt (dedupeKey), dus dubbel klikken maakt geen dubbele taak.
 */
export async function createReportActionTask(input: { reportId: string; key: string; title: string; description?: string; rol?: string; assigneeId: string | null; dueOn?: string | null }): Promise<ActionResult & { taskId?: string }> {
  return guard(async () => {
    const viewer = await requirePermission("tasks:write");
    if (!canSeeReports(viewer)) return { ok: false, message: "Je hebt geen toegang tot maandrapportages." };
    const row = await loadReportClient(input.reportId);
    if (!row) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, row.clientId);
    if (!APPROVED_STATUSES.includes(row.status as ReportStatus) && !viewer.permissions.has("reports:write")) return { ok: false, message: "Rapport is nog niet goedgekeurd." };
    const title = input.title.trim().slice(0, 200);
    if (!title) return { ok: false, message: "Geef de taak een titel." };
    if (!/^[a-z0-9_-]{1,40}$/i.test(input.key)) return { ok: false, message: "Ongeldig actiepunt." };
    if (input.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return { ok: false, message: "Ongeldige datum." };
    const dedupeKey = `report_action:${input.reportId}:${input.key}`;
    const [exists] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dedupeKey, dedupeKey), isNull(tasks.deletedAt))).limit(1);
    if (exists) return { ok: false, message: "Voor dit actiepunt bestaat al een taak." };
    const [created] = await db.insert(tasks).values({
      clientId: row.clientId,
      title: `${title} (${row.clientName})`.slice(0, 240),
      description: [`Uit de maandrapportage ${periodLabel(row.period)} van ${row.clientName}.`, input.description ?? ""].filter(Boolean).join("\n\n").slice(0, 4000),
      // Werkzaamheden (niet klantcontact): het team voert dit zelf uit.
      category: "overig",
      assigneeId: input.assigneeId,
      dueOn: input.dueOn || null,
      entityType: "client_report",
      entityId: input.reportId,
      source: "manual",
      dedupeKey,
      createdById: viewer.id,
    }).returning({ id: tasks.id });
    if (input.assigneeId && input.assigneeId !== viewer.id) {
      await notify({
        userIds: [input.assigneeId],
        clientId: row.clientId,
        type: "task_assigned",
        level: "info",
        title: "Nieuw actiepunt uit de maandrapportage",
        body: `${title} (${row.clientName}, ${periodLabel(row.period)})`,
        href: `/analytics/maandrapportages/${input.reportId}`,
        entityType: "task",
        entityId: created!.id,
        dedupeKey: `report_action_assigned:${created!.id}`,
      }).catch(() => undefined);
    }
    await auditLog({ viewer, action: "report.action_task_created", entityType: "client_report", entityId: input.reportId, clientId: row.clientId });
    revalidatePath(`/analytics/maandrapportages/${input.reportId}`);
    revalidatePath("/analytics/maandrapportages");
    return { ok: true, taskId: created!.id };
  });
}
