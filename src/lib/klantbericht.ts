/**
 * Standaard klantbericht voor de eerste versies van de video's (Editing →
 * "Kopieer klantbericht"). Dit is de standaardtekst; beheerders kunnen de
 * tekst centraal aanpassen (app-instelling `editing.klantbericht`), waarna de
 * nieuwe versie direct voor alle medewerkers geldt.
 *
 * Opsommingstekens zijn bewust "•" (en geen "*"), zodat de tekst in WhatsApp,
 * mail en andere kanalen hetzelfde oogt en "*" niet als vetgedrukt wordt gelezen.
 */
export const KLANTBERICHT_SETTING_KEY = "editing.klantbericht";

export const DEFAULT_KLANTBERICHT = [
  "Goedemorgen!",
  "",
  "De eerste versies van de video's staan klaar in het portaal!",
  "",
  "Bekijk de video's hier:",
  "[Voeg videolink toe]",
  "",
  "De video's zijn al intern gecontroleerd.",
  "",
  "Goed om te weten:",
  "",
  "• 5 minuten: zo lang duurt het beoordelen gemiddeld.",
  "• Correcties: eventuele feitelijke onjuistheden kun je gebundeld als opmerkingen bij de video's in het portaal plaatsen. Eén correctieronde is inbegrepen.",
  "• 3 werkdagen: graag eventuele opmerkingen binnen deze termijn doorgeven. Als er geen opmerkingen zijn, gaan we daarna verder met de contentplanning.",
  "",
  "Alvast bedankt! 😊",
].join("\n");

/** Maximale lengte van het bericht (ruim genoeg, maar geen onbegrensde invoer). */
export const KLANTBERICHT_MAX_LENGTH = 4000;

/** Regeleinden normaliseren (Windows/Mac) en spaties aan het einde van regels weghalen. */
export function normalizeKlantbericht(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/u, ""))
    .join("\n")
    .trim();
}
