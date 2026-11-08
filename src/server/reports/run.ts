import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, monthlyReportFeedback, monthlyReportVersions } from "@/db/schema";
import { recordActivity } from "@/server/audit";
import { syncReportBatches } from "./batch";
import { generateMonthlyAnalysis, periodLabel, previousMonthPeriod, type MonthlyAnalysis } from "./analysis";

const STALE_RUNNING_MIN = 15;

export type EnsureReportResult =
  | { ok: true; reportId: string; status: "klaar_voor_controle" }
  | { ok: false; reason: "no_data" | "no_provider" | "in_progress" | "error"; message?: string; reportId?: string };

function reportTitle(period: string): string {
  return `Maandrapport ${periodLabel(period)}`;
}

/** Korte samenvatting van het vorige (goedgekeurde) maandrapport, voor de leerlus. */
async function priorSummary(clientId: string, period: string): Promise<string | null> {
  const prev = previousMonthPeriod(period);
  const [row] = await db
    .select({ analysis: clientReports.analysis, status: clientReports.status })
    .from(clientReports)
    .where(and(eq(clientReports.clientId, clientId), eq(clientReports.period, prev), isNull(clientReports.deletedAt)))
    .limit(1);
  if (!row) return null;
  const a = row.analysis as Partial<MonthlyAnalysis> | null;
  const recs = Array.isArray(a?.verbeterpunten) ? a!.verbeterpunten.map((r) => r.titel).filter(Boolean) : [];
  const acties = Array.isArray(a?.strategischeActies) ? a!.strategischeActies.map((x) => x.titel).filter(Boolean) : [];
  const alles = [...recs, ...acties];
  return alles.length ? `Vorige maand (${periodLabel(prev)}) adviezen/acties: ${alles.join("; ")}` : null;
}

/**
 * Zorgt dat het maandrapport voor één klant + maand actueel is. Statusflow
 * gegevens_verzamelen → analyse_bezig → klaar_voor_controle (of mislukt).
 * `mode`: "ai_only" vernieuwt alleen de AI-analyse en laat de persoonlijke
 * beoordeling + handmatige notitie staan; "full" stelt het concept opnieuw op.
 */
export async function ensureMonthlyReport(
  clientId: string,
  period: string,
  opts: { force?: boolean; triggeredById?: string | null; mode?: "ai_only" | "full" } = {},
): Promise<EnsureReportResult> {
  const [client] = await db
    .select({ id: clients.id, name: clients.name, coordinatorId: clients.coordinatorId })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return { ok: false, reason: "error", message: "Klant niet gevonden." };

  const [existing] = await db
    .select({ id: clientReports.id, status: clientReports.status, startedAt: clientReports.startedAt })
    .from(clientReports)
    .where(and(eq(clientReports.clientId, clientId), eq(clientReports.period, period), eq(clientReports.periodType, "month"), isNull(clientReports.deletedAt)))
    .limit(1);

  // Dubbel-draai-guard.
  if (existing && existing.status === "analyse_bezig" && existing.startedAt && !opts.force) {
    if ((Date.now() - existing.startedAt.getTime()) / 60000 < STALE_RUNNING_MIN) return { ok: false, reason: "in_progress", reportId: existing.id };
  }

  const now = new Date();
  let reportId: string;
  if (existing) {
    await db.update(clientReports).set({ status: "analyse_bezig", startedAt: now, errorMessage: null, updatedAt: now }).where(eq(clientReports.id, existing.id));
    reportId = existing.id;
  } else {
    const [created] = await db
      .insert(clientReports)
      .values({ clientId, periodType: "month", period, title: reportTitle(period), status: "analyse_bezig", startedAt: now, generatedById: opts.triggeredById ?? null })
      .returning({ id: clientReports.id });
    reportId = created!.id;
  }

  const prior = await priorSummary(clientId, period);
  // Openstaande feedback van de controleur gaat mee in deze generatie.
  const openFeedback = await db
    .select({ id: monthlyReportFeedback.id, body: monthlyReportFeedback.body })
    .from(monthlyReportFeedback)
    .where(and(eq(monthlyReportFeedback.reportId, reportId), isNull(monthlyReportFeedback.resolvedInVersion)))
    .orderBy(monthlyReportFeedback.createdAt);
  const res = await generateMonthlyAnalysis(clientId, period, { trusted: true, priorSummary: prior, feedback: openFeedback.map((f) => f.body) });
  if (!res.ok) {
    const message = res.reason === "no_provider" ? "Er is nog geen AI-sleutel ingesteld." : res.reason === "no_data" ? "Geen resultaten in deze maand om te analyseren." : res.message ?? "Analyse mislukt.";
    await db.update(clientReports).set({ status: "mislukt", errorMessage: message.slice(0, 500), startedAt: null, updatedAt: new Date() }).where(eq(clientReports.id, reportId));
    return { ok: false, reason: res.reason === "no_data" ? "no_data" : res.reason === "no_provider" ? "no_provider" : "error", message, reportId };
  }

  const summary = res.analysis.analysis.ontwikkelingen.join(" ") || res.analysis.maandvergelijking?.join(" ") || "";
  const patch: Record<string, unknown> = {
    status: "klaar_voor_controle",
    analysis: res.analysis as unknown as Record<string, unknown>,
    aandachtspunten: res.analysis.aandachtspunten as unknown as Record<string, unknown>,
    strategischeActies: res.analysis.strategischeActies as unknown as Record<string, unknown>,
    metrics: res.totals as unknown as Record<string, unknown>,
    summary,
    ontbrekendeGegevens: res.ontbrekend as unknown as Record<string, unknown>,
    generatedAt: new Date(),
    kwaliteit: {},
    startedAt: null,
    errorMessage: null,
    updatedAt: new Date(),
  };
  // Volledige herstart wist ook de persoonlijke beoordeling; standaard behouden we die.
  if (opts.mode === "full") patch.beoordeling = {};
  await db.update(clientReports).set(patch).where(eq(clientReports.id, reportId));

  // Elke generatie wordt als versie bewaard (traceerbaar wat er veranderde).
  const versionNumber = await snapshotVersion(reportId, "generatie", opts.triggeredById ?? null);
  if (openFeedback.length) {
    for (const f of openFeedback) {
      await db.update(monthlyReportFeedback).set({ resolvedInVersion: versionNumber }).where(eq(monthlyReportFeedback.id, f.id));
    }
  }

  // Maandcontrole: één taak en één melding per controleur per maand (geen
  // losse melding of taak per klant meer). Idempotent.
  await syncReportBatches().catch(() => undefined);

  await recordActivity({ clientId, type: "report.generated", title: `Maandrapportage ${periodLabel(period)} klaar voor controle`, isClientVisible: false }).catch(() => undefined);

  return { ok: true, reportId, status: "klaar_voor_controle" };
}

/**
 * Slaat de huidige inhoud van een rapport op als nieuwe versie en geeft het
 * versienummer terug. `kind`: generatie, goedkeuring of publicatie.
 */
export async function snapshotVersion(reportId: string, kind: "generatie" | "goedkeuring" | "publicatie", byId: string | null): Promise<number> {
  const [r] = await db
    .select({ analysis: clientReports.analysis, beoordeling: clientReports.beoordeling, metrics: clientReports.metrics, strategischeActies: clientReports.strategischeActies, aandachtspunten: clientReports.aandachtspunten })
    .from(clientReports)
    .where(eq(clientReports.id, reportId))
    .limit(1);
  const [last] = await db
    .select({ n: monthlyReportVersions.versionNumber })
    .from(monthlyReportVersions)
    .where(eq(monthlyReportVersions.reportId, reportId))
    .orderBy(desc(monthlyReportVersions.versionNumber))
    .limit(1);
  const versionNumber = (last?.n ?? 0) + 1;
  await db.insert(monthlyReportVersions).values({
    reportId,
    versionNumber,
    kind,
    content: (r ?? {}) as unknown as Record<string, unknown>,
    approvedById: byId,
  });
  return versionNumber;
}
