import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports } from "@/db/schema";
import { getLatestInsights, type ClientInsights } from "@/server/insights";

/**
 * Prestatiecontext voor AI Content Research: wat er bij deze klant AANTOONBAAR
 * werkt, uit de echte resultaten en de goedgekeurde maandrapportages. Dit maakt
 * het onderzoek lerend — nieuwe rapportages sturen vanzelf het volgende onderzoek
 * (geen aparte leerstap nodig). Leest alléén opgeslagen analyses; verzint niets en
 * draait zonder sessie (voor de cron/achtergrond).
 */
export type PerformanceContext = {
  /** Compacte tekst voor in de onderzoeks-/ideeënprompt. Leeg als er geen data is. */
  text: string;
  /** Of er bruikbare resultaten/rapportage-analyse beschikbaar is. */
  hasData: boolean;
  /** Periode van de meest recente meegewogen maandrapportage (YYYY-MM), indien bekend. */
  laatsteRapportage: string | null;
};

const EMPTY: PerformanceContext = { text: "", hasData: false, laatsteRapportage: null };

function findingsText(label: string, items: Array<{ punt: string; zekerheid?: string }> | undefined): string | null {
  if (!items || items.length === 0) return null;
  const lines = items
    .slice(0, 6)
    .map((f) => (f?.punt ? `- ${f.punt}${f.zekerheid ? ` [${f.zekerheid}]` : ""}` : null))
    .filter(Boolean);
  return lines.length ? `${label}:\n${lines.join("\n")}` : null;
}

function insightsToText(ci: ClientInsights, bron: string): string[] {
  const parts: string[] = [];
  const wat = findingsText("Wat werkt", ci.analysis?.watWerkt);
  const minder = findingsText("Wat minder werkt", ci.analysis?.watMinder);
  if (wat) parts.push(wat);
  if (minder) parts.push(minder);

  if (ci.topVideos && ci.topVideos.length) {
    const tv = ci.topVideos
      .slice(0, 4)
      .map((v) => `- ${v.titel}${v.cijfers ? ` (${v.cijfers})` : ""}${v.waarom ? ` — ${v.waarom}` : ""}`)
      .join("\n");
    parts.push(`Best presterende video's:\n${tv}`);
  }
  if (ci.besteHooks && ci.besteHooks.length) {
    const h = ci.besteHooks.slice(0, 5).map((x) => `- "${x.hook}"${x.waarom ? ` — ${x.waarom}` : ""}`).join("\n");
    parts.push(`Best werkende hooks:\n${h}`);
  }
  if (ci.besteFormats && ci.besteFormats.length) {
    const f = ci.besteFormats.slice(0, 4).map((x) => `- ${x.format}${x.waarom ? ` — ${x.waarom}` : ""}`).join("\n");
    parts.push(`Best werkende formats:\n${f}`);
  }
  if (ci.mindereVideos && ci.mindereVideos.length) {
    const m = ci.mindereVideos.slice(0, 3).map((x) => `- ${x.titel}${x.les ? ` — les: ${x.les}` : ""}`).join("\n");
    parts.push(`Minder presterende video's (lessen):\n${m}`);
  }
  if (ci.maandvergelijking && ci.maandvergelijking.length) {
    parts.push(`Maandvergelijking:\n- ${ci.maandvergelijking.slice(0, 4).join("\n- ")}`);
  }
  if (ci.verbeterpunten && ci.verbeterpunten.length) {
    const v = ci.verbeterpunten
      .slice(0, 5)
      .map((r) => `- ${r.titel}${r.waarom ? ` — waarom: ${r.waarom}` : ""}${r.wat ? ` — wat: ${r.wat}` : ""}`)
      .join("\n");
    parts.push(`Eerdere verbeterpunten (nog uitvoeren/checken):\n${v}`);
  }
  return parts.length ? [`BRON: ${bron}`, ...parts] : [];
}

/** Haalt de meest recente goedgekeurde/gepubliceerde maandrapportage-analyse op. */
async function latestReport(clientId: string): Promise<{ period: string; analysis: ClientInsights; beoordeling: Record<string, unknown> } | null> {
  const [row] = await db
    .select({
      period: clientReports.period,
      analysis: clientReports.analysis,
      beoordeling: clientReports.beoordeling,
    })
    .from(clientReports)
    .where(
      and(
        eq(clientReports.clientId, clientId),
        isNull(clientReports.deletedAt),
        inArray(clientReports.status, ["goedgekeurd", "gepubliceerd"]),
      ),
    )
    .orderBy(desc(clientReports.period), desc(clientReports.approvedAt))
    .limit(1);
  if (!row) return null;
  const analysis = (row.analysis ?? {}) as ClientInsights;
  return { period: row.period, analysis, beoordeling: (row.beoordeling ?? {}) as Record<string, unknown> };
}

export async function buildPerformanceContext(clientId: string): Promise<PerformanceContext> {
  const [insights, report] = await Promise.all([
    getLatestInsights(clientId).catch(() => null),
    latestReport(clientId).catch(() => null),
  ]);

  const blocks: string[] = [];
  let laatsteRapportage: string | null = null;

  if (report) {
    laatsteRapportage = report.period;
    const repText = insightsToText(report.analysis, `goedgekeurde maandrapportage ${report.period}`);
    blocks.push(...repText);
    // Persoonlijke beoordeling (conclusies van het team richting de klant).
    const b = report.beoordeling;
    const beo: string[] = [];
    if (typeof b.positief === "string" && b.positief.trim()) beo.push(`- Ging goed: ${b.positief.trim()}`);
    if (typeof b.verbeteren === "string" && b.verbeteren.trim()) beo.push(`- Beter kunnen: ${b.verbeteren.trim()}`);
    if (typeof b.volgendeMaand === "string" && b.volgendeMaand.trim()) beo.push(`- Plan volgende maand: ${b.volgendeMaand.trim()}`);
    if (beo.length) blocks.push(`Conclusies uit het maandrapport (team):\n${beo.join("\n")}`);
  }

  if (insights) {
    const insText = insightsToText(insights.insights, "resultatenanalyse (Metricool-cijfers)");
    blocks.push(...insText);
  }

  if (blocks.length === 0) return EMPTY;

  const text = [
    "PRESTATIES & RESULTATEN VAN DEZE KLANT (uit echte cijfers en goedgekeurde maandrapportages — laat dit je ideeën en advies sturen):",
    ...blocks,
  ].join("\n\n");

  return { text, hasData: true, laatsteRapportage };
}
