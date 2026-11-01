import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, tasks } from "@/db/schema";
import { notify } from "@/server/notifications";
import { recordActivity } from "@/server/audit";
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
  const res = await generateMonthlyAnalysis(clientId, period, { trusted: true, priorSummary: prior });
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
    startedAt: null,
    errorMessage: null,
    updatedAt: new Date(),
  };
  // Volledige herstart wist ook de persoonlijke beoordeling; standaard behouden we die.
  if (opts.mode === "full") patch.beoordeling = {};
  await db.update(clientReports).set(patch).where(eq(clientReports.id, reportId));

  // PM notificeren + controletaak (één open taak per rapport).
  const coordinatorId = client.coordinatorId;
  await notify({
    roles: ["project_coordinator", "operational_manager"],
    userIds: coordinatorId ? [coordinatorId] : undefined,
    clientId,
    level: "info",
    type: "report_review",
    title: "Maandrapportage klaar voor controle",
    body: `De AI-maandanalyse voor ${client.name} (${periodLabel(period)}) staat klaar voor controle.`,
    href: `/analytics/maandrapportages/${reportId}`,
    entityType: "client_report",
    entityId: reportId,
    dedupeKey: `report_review:${reportId}`,
  }).catch(() => undefined);

  if (coordinatorId) {
    await db
      .insert(tasks)
      .values({
        clientId,
        title: `Maandrapport controleren — ${client.name} (${periodLabel(period)})`,
        category: "overig",
        assigneeId: coordinatorId,
        entityType: "client_report",
        entityId: reportId,
        source: "automation",
        dedupeKey: `report_review:${reportId}`,
      })
      .onConflictDoNothing()
      .catch(() => undefined);
  }

  await recordActivity({ clientId, type: "report.generated", title: `Maandrapportage ${periodLabel(period)} klaar voor controle`, isClientVisible: false }).catch(() => undefined);

  return { ok: true, reportId, status: "klaar_voor_controle" };
}
