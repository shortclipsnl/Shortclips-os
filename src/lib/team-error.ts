/**
 * Foutteksten voor medewerkers, editors en klanten.
 *
 * Technische details (HTTP-codes, API-sleutels, tokens, databasefouten,
 * koppelingsnamen) zijn uitsluitend voor de eigenaar. Iedereen anders krijgt
 * een korte, begrijpelijke melding met een vervolgstap. De volledige fout staat
 * altijd in het centrale foutlogboek (Instellingen > Koppelingsbewaking).
 *
 * Al begrijpelijke, inhoudelijke meldingen ("Geen captions herkend in de PDF.",
 * "Niet gegenereerd: de klant staat op niet actief.") blijven gewoon zichtbaar:
 * daar kan de medewerker zelf iets mee.
 */

export const TEAM_TECH_ERROR =
  "Dit is niet gelukt door een technisch probleem. Probeer het later opnieuw; Jarno is automatisch op de hoogte.";

const TECHNICAL =
  /https?:|\bhttp\b|\bhttp \d|\b[45]\d\d\b|error|failed|exception|undefined|null\b|token|api[ _-]?key|\bapi\b|json|sql|query|econn|enotfound|timeout|timed out|invalid|unauthori|forbidden|anthropic|openai|tegoed|sleutel|configuratie|koppeling|oauth|invalid_grant|metricool|frame\.io|frameio|pandadoc|google|vercel|supabase|[{}<>[\]`]|\w+_\w+|\bat \w+[.(]/i;

/** Is deze melding technisch (alleen voor de eigenaar)? */
export function isTechnicalError(message: string): boolean {
  return TECHNICAL.test(message);
}

/**
 * De fouttekst die deze kijker mag zien. Eigenaar: alles. Anderen: de melding
 * zelf als die begrijpelijk en niet-technisch is, anders `TEAM_TECH_ERROR`.
 */
export function errorForViewer(owner: boolean, message: string | null | undefined): string | null {
  if (!message) return null;
  if (owner) return message;
  return isTechnicalError(message) ? TEAM_TECH_ERROR : message;
}
