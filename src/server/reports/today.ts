import "server-only";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients, monthlyReportReads } from "@/db/schema";
import { isOwner, type Viewer } from "@/server/auth/context";
import { periodLabel } from "./analysis";
import { checkReportQuality, type Beoordeling } from "./quality";

export type ReportWorkSummary = {
  /** Gegenereerd of in controle (beoordelen / goedkeuren). */
  teControleren: number;
  /** Goedgekeurd maar nog niet gepubliceerd. */
  tePubliceren: number;
  mislukt: number;
  /** Oudste maand met openstaand werk (voor de link). */
  period: string | null;
};

const STALE_MS = 20 * 60000;

/**
 * Compact overzicht van openstaand maandrapportagewerk voor één medewerker,
 * voor de Vandaag-pagina. De eigenaar ziet alles (hij keurt goed); een
 * coördinator ziet de rapporten van zijn eigen klanten. Alleen de laatste drie
 * maanden, zodat oude restjes de dagstart niet vervuilen.
 */
export async function reportWorkSummary(person: Viewer, today: string): Promise<ReportWorkSummary | null> {
  if (person.isPortalUser || !person.permissions.has("reports:read")) return null;
  const [y, m] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y!, (m ?? 1) - 4, 1));
  const minPeriod = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
  const owner = isOwner(person);

  const rows = await db
    .select({
      period: clientReports.period, status: clientReports.status, startedAt: clientReports.startedAt,
      analysis: clientReports.analysis, beoordeling: clientReports.beoordeling, metrics: clientReports.metrics,
      ontbrekend: clientReports.ontbrekendeGegevens,
    })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .where(and(
      eq(clientReports.periodType, "month"),
      isNull(clientReports.deletedAt),
      isNull(clients.deletedAt),
      gte(clientReports.period, minPeriod),
      inArray(clientReports.status, ["klaar_voor_controle", "aanpassing_nodig", "goedgekeurd", "mislukt", "analyse_bezig"]),
      owner ? undefined : eq(clients.coordinatorId, person.id),
    ));

  let teControleren = 0, tePubliceren = 0, mislukt = 0;
  let period: string | null = null;
  const mark = (p: string) => { if (!period || p < period) period = p; };
  for (const r of rows) {
    if (r.status === "klaar_voor_controle" || r.status === "aanpassing_nodig") {
      // Coördinatoren: alleen zolang hun beoordeling nog openstaat; daarna ligt
      // de bal bij de eigenaar (goedkeuren).
      if (!owner) {
        const blok = checkReportQuality({
          clientName: "", analysis: r.analysis as never, beoordeling: (r.beoordeling ?? {}) as Beoordeling,
          metrics: (r.metrics ?? {}) as never, ontbrekendeGegevens: Array.isArray(r.ontbrekend) ? (r.ontbrekend as string[]) : [],
        }).some((i) => i.severity === "blok");
        if (!blok && r.status === "klaar_voor_controle") continue;
      }
      teControleren++; mark(r.period);
    } else if (r.status === "goedgekeurd") {
      tePubliceren++; mark(r.period);
    } else if (r.status === "mislukt" || (r.status === "analyse_bezig" && (!r.startedAt || Date.now() - r.startedAt.getTime() > STALE_MS))) {
      mislukt++; mark(r.period);
    }
  }
  if (!teControleren && !tePubliceren && !mislukt) return null;
  return { teControleren, tePubliceren, mislukt, period };
}

/** Titel en toelichting voor het ene Vandaag-item. */
export function reportWorkText(s: ReportWorkSummary): { title: string; detail: string } {
  const parts: string[] = [];
  if (s.teControleren) parts.push(`${s.teControleren} controleren`);
  if (s.tePubliceren) parts.push(`${s.tePubliceren} publiceren`);
  if (s.mislukt) parts.push(`${s.mislukt} mislukt`);
  return {
    title: `Maandrapportages: ${parts.join(", ")}`,
    detail: s.period ? `Vanaf ${periodLabel(s.period)}. Alles staat op de pagina Maandrapportages.` : "Alles staat op de pagina Maandrapportages.",
  };
}

/**
 * Voor teamleden die maandrapportages alleen doornemen (geen controlerecht):
 * hoeveel goedgekeurde rapportages er nog door hen gelezen moeten worden.
 */
export async function reportReadSummary(person: Viewer): Promise<{ open: number; period: string | null } | null> {
  if (person.isPortalUser || person.permissions.has("reports:read") || !person.permissions.has("reports:team_read")) return null;
  const rows = await db
    .select({ period: clientReports.period })
    .from(monthlyReportReads)
    .innerJoin(clientReports, eq(clientReports.id, monthlyReportReads.reportId))
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .where(and(
      eq(monthlyReportReads.userId, person.id),
      isNull(monthlyReportReads.readAt),
      inArray(clientReports.status, ["goedgekeurd", "gepubliceerd"]),
      isNull(clientReports.deletedAt),
      isNull(clients.deletedAt),
    ));
  if (!rows.length) return null;
  const period = rows.map((r) => r.period).sort().at(-1) ?? null;
  return { open: rows.length, period };
}
