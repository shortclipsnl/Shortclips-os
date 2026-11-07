import type { MonthlyAnalysis } from "./analysis";

export type Beoordeling = { positief?: string; verbeteren?: string; volgendeMaand?: string; klanttekst?: string };

export type QualityIssue = {
  id: string;
  label: string;
  /** "blok" = moet opgelost zijn vóór goedkeuren; "let_op" = aandachtspunt. */
  severity: "blok" | "let_op";
};

export type ReportForQuality = {
  clientName: string;
  analysis: Partial<MonthlyAnalysis> | null;
  beoordeling: Beoordeling | null;
  metrics: { views?: number; posts?: number; viewsGrowthPct?: number | null } | null;
  ontbrekendeGegevens: string[];
  /** Uitkomst van de dubbele-cijfers-controle (zie metrics.ts). */
  dubbel?: { severity: "blok" | "let_op"; label: string } | null;
};

/**
 * Deterministische interne kwaliteitscontrole van een maandrapport (sectie 9).
 * Nooit zichtbaar voor de klant. "blok"-punten blokkeren goedkeuren.
 */
export function checkReportQuality(r: ReportForQuality): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const a = r.analysis ?? {};
  const b = r.beoordeling ?? {};
  const m = r.metrics ?? {};

  // Verplicht: persoonlijke beoordeling ingevuld.
  const beoordelingLeeg = !((b.positief ?? "").trim() && (b.verbeteren ?? "").trim() && (b.volgendeMaand ?? "").trim());
  if (beoordelingLeeg) issues.push({ id: "beoordeling", label: "De persoonlijke Shortclips-beoordeling (3 vragen) is nog niet volledig ingevuld.", severity: "blok" });

  // Verplicht: er moeten verbeterpunten zijn.
  if (!Array.isArray(a.verbeterpunten) || a.verbeterpunten.length === 0) issues.push({ id: "verbeterpunten", label: "De analyse bevat geen verbeterpunten.", severity: "blok" });

  // Aandachtspunten / strategische acties aanwezig.
  if (!Array.isArray(a.strategischeActies) || a.strategischeActies.length === 0) issues.push({ id: "acties", label: "Er zijn geen strategische actiepunten voor volgende maand.", severity: "let_op" });

  // Klanttekst.
  if (!((b.klanttekst ?? "").trim())) issues.push({ id: "klanttekst", label: "Er is nog geen persoonlijke klanttekst gemaakt.", severity: "let_op" });

  // Data-kwaliteit.
  if ((m.views ?? 0) === 0) issues.push({ id: "views", label: "Er zijn geen weergaven geregistreerd deze maand — controleer de koppeling.", severity: "let_op" });
  if ((m.posts ?? 0) === 0 && !(r.ontbrekendeGegevens ?? []).some((g) => g.includes("geen gepubliceerde video"))) issues.push({ id: "posts", label: "Er zijn geen gepubliceerde video's geregistreerd deze maand.", severity: "let_op" });
  if (m.viewsGrowthPct != null && Math.abs(m.viewsGrowthPct) > 1000) issues.push({ id: "groei", label: `Onwaarschijnlijke groei (${m.viewsGrowthPct}%) — controleer of de vergelijkingsperiode klopt.`, severity: "let_op" });

  // Identieke cijfers als een andere klant: verkeerde koppeling.
  if (r.dubbel) issues.push({ id: "dubbel", label: r.dubbel.label, severity: r.dubbel.severity });

  // Ontbrekende gegevens uit de analyse meenemen.
  for (const [i, g] of (r.ontbrekendeGegevens ?? []).entries()) {
    issues.push({ id: `ontbrekend_${i}`, label: g, severity: "let_op" });
  }

  return issues;
}

/** Of het rapport goedgekeurd mag worden (geen blokkerende punten open). */
export function canApprove(issues: QualityIssue[]): boolean {
  return !issues.some((i) => i.severity === "blok");
}
