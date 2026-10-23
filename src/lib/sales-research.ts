/**
 * Gedeelde constanten voor AI Sales Research — importeerbaar door zowel
 * server-actions als client-componenten (geen "use server"/"server-only").
 */

/** Doelstellingen waaruit het salesteam kan kiezen (plus "Anders"). */
export const SALES_GOALS = [
  "Meer online bereik",
  "Meer naamsbekendheid",
  "Meer volgers",
  "Meer aanvragen",
  "Meer klanten",
  "Meer sollicitanten",
  "Meer vertrouwen en autoriteit",
  "Anders",
] as const;

/** Statussen van een sales-onderzoek (dossier). */
export const RESEARCH_STATUSES = ["concept", "onderzoek_bezig", "onderzoek_afgerond", "presentatie_gereed", "gepresenteerd", "klant_geworden"] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const RESEARCH_STATUS_LABEL: Record<string, string> = {
  concept: "Concept",
  onderzoek_bezig: "Onderzoek bezig",
  onderzoek_afgerond: "Onderzoek afgerond",
  presentatie_gereed: "Presentatie gereed",
  gepresenteerd: "Gepresenteerd",
  klant_geworden: "Klant geworden",
  // Oude waarde blijft leesbaar.
  klaar: "Onderzoek afgerond",
};
