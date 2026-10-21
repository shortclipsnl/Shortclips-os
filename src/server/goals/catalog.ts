import type { GoalType } from "./status";

/** De vier pijlers met hun labels (volgorde bepaalt de weergave). */
export const PILLARS: { key: string; label: string }[] = [
  { key: "sales", label: "Sales en groei" },
  { key: "productie", label: "Productie en capaciteit" },
  { key: "team", label: "Team en zelfstandigheid" },
  { key: "systemen", label: "Systemen en klantresultaten" },
];
export const PILLAR_LABEL: Record<string, string> = Object.fromEntries(PILLARS.map((p) => [p.key, p.label]));

export const Q4_START = "2026-10-01";
export const Q4_END = "2026-12-31";

export type GoalSeed = {
  key: string; // stabiele sleutel voor idempotente seed
  pillar: string;
  title: string;
  type: GoalType;
  source: "live" | "manual";
  metricKey?: string | null;
  target?: number | null;
  unit?: string | null;
  visibility?: "team" | "founders";
  milestones?: string[];
};

/**
 * De 22 Q4-doelen. Live doelen hebben een metricKey (zie metrics.ts); handmatige
 * doelen starten op "Nog niet gemeten" (current 0, geen live bron). Doelen zonder
 * target tonen "Doel nog instellen". Eigenaar bewust leeg: Jarno wijst zelf toe.
 */
export const GOAL_CATALOG: GoalSeed[] = [
  // Sales en groei
  { key: "sales_new_clients", pillar: "sales", title: "10 nieuwe klanten met een contract van minimaal 3 maanden", type: "count", source: "live", metricKey: "new_clients_q4", target: 10, unit: "klanten" },
  { key: "sales_mrr", pillar: "sales", title: "25.000 euro extra maandelijkse contractomzet", type: "count", source: "manual", target: 25000, unit: "euro", visibility: "founders" },
  { key: "sales_calls", pillar: "sales", title: "Minimaal 20 gekwalificeerde salesgesprekken", type: "count", source: "manual", target: 20, unit: "gesprekken" },
  { key: "sales_quotes", pillar: "sales", title: "Minimaal 15 offertes versturen", type: "count", source: "manual", target: 15, unit: "offertes" },
  { key: "sales_renewals", pillar: "sales", title: "5 bestaande klanten verlengen of uitbreiden", type: "count", source: "manual", target: 5, unit: "klanten" },
  { key: "sales_leads", pillar: "sales", title: "Een constante stroom van nieuwe leads", type: "weekly", source: "live", metricKey: "leads_weekly", target: null, unit: "leads per week" },

  // Productie en capaciteit
  { key: "prod_script_quality", pillar: "productie", title: "Scriptkwaliteit onafhankelijk maken van Jarno", type: "norm", source: "live", metricKey: "scripts_without_jarno", target: 90, unit: "%" },
  { key: "prod_shoots_planned", pillar: "productie", title: "Alle klantopnames tot eind december ingepland", type: "norm", source: "live", metricKey: "shoots_through_dec", target: 100, unit: "%" },
  { key: "prod_second_videographer", pillar: "productie", title: "Een tweede zelfstandige freelance videograaf klaarstomen", type: "milestone", source: "manual", milestones: ["Proefopname gedaan", "Eerste zelfstandige opname", "3 zelfstandige opnames zonder correctie"] },
  { key: "prod_reserve_editors", pillar: "productie", title: "2 tot 3 reserve editors klaar hebben staan", type: "count", source: "manual", target: 2, unit: "editors" },
  { key: "prod_ontime", pillar: "productie", title: "95% van alle projecten binnen de deadline opleveren", type: "norm", source: "live", metricKey: "ontime_rate", target: 95, unit: "%" },
  { key: "prod_capacity_40", pillar: "productie", title: "Productiecapaciteit voor 40 actieve klanten voorbereiden", type: "count", source: "manual", target: 40, unit: "klanten" },
  { key: "prod_guidelines", pillar: "productie", title: "Opnamehandleiding en editrichtlijnen volledig afronden", type: "milestone", source: "manual", milestones: ["Opnamehandleiding afgerond", "Editrichtlijnen afgerond"] },

  // Team en zelfstandigheid
  { key: "team_production_without_jarno", pillar: "team", title: "90% van de dagelijkse productie zonder Jarno", type: "norm", source: "live", metricKey: "production_without_jarno", target: 90, unit: "%" },
  { key: "team_milou_jiska", pillar: "team", title: "Milou en Jiska volledig verantwoordelijk voor hun onderdelen", type: "milestone", source: "manual", milestones: ["Milou: onderdelen vastgelegd en overgedragen", "Jiska: onderdelen vastgelegd en overgedragen"] },
  { key: "team_weekly_training", pillar: "team", title: "Iedere week een interne kwaliteitstraining", type: "weekly", source: "manual", target: 1, unit: "per week" },
  { key: "team_weekly_meeting", pillar: "team", title: "Vaste wekelijkse productieoverleggen zelfstandig laten verlopen", type: "weekly", source: "manual", target: 1, unit: "per week" },
  { key: "team_backup_roles", pillar: "team", title: "Voor iedere cruciale functie een vervanger beschikbaar", type: "milestone", source: "manual", milestones: ["Scripting: vervanger", "Opname: vervanger", "Editing: vervanger", "Klantcontact: vervanger"] },

  // Systemen en klantresultaten
  { key: "sys_portal_ready", pillar: "systemen", title: "Het klantenportaal klaar voor een eerste praktijktest", type: "milestone", source: "manual", milestones: ["Login per klant werkt", "Video's, scripts en planning zichtbaar", "Resultaten zichtbaar", "Eerste klant test uitgevoerd"] },
  { key: "sys_results_visible", pillar: "systemen", title: "Alle klantresultaten inzichtelijk", type: "norm", source: "live", metricKey: "results_coverage", target: 100, unit: "%" },
  { key: "sys_monthly_evals", pillar: "systemen", title: "Maandelijkse evaluaties voor alle actieve klanten", type: "monthly", source: "manual", target: 100, unit: "%" },
  { key: "sys_cases", pillar: "systemen", title: "Minimaal 5 nieuwe klantcases of testimonials", type: "count", source: "manual", target: 5, unit: "cases" },
];
