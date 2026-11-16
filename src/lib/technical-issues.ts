/**
 * Vertaalt een geregistreerde technische fout (bron + melding uit error_logs)
 * naar wat Jarno als beheerder moet weten: welke koppeling of welk onderdeel,
 * en welke actie nodig is. Pure functies, zodat ze te testen zijn.
 *
 * Alleen voor het beheerdersoverzicht. Medewerkers zien deze teksten nooit.
 */

export type IssueDescription = {
  /** Koppeling of onderdeel, zoals "Google Drive" of "Portaal". */
  system: string;
  /** Wat er moet gebeuren. Altijd concreet; "geen actie" als het vanzelf herstelt. */
  action: string;
  /** Moet Jarno zelf iets doen? */
  needsOwner: boolean;
};

const SYSTEM_BY_PREFIX: Record<string, string> = {
  google_drive: "Google Drive",
  google_calendar: "Google Agenda",
  gmail: "Leads (mailbox)",
  frameio: "Frame.io",
  metricool: "Metricool",
  monday: "Monday (oud)",
  monitor: "Meldingen per mail",
  portaal: "Portaal",
};

const SYSTEM_BY_TASK: Record<string, string> = {
  captions: "Caption Maker",
  klantonderzoek: "Klantonderzoek",
  content_research: "Content Research",
  editorbriefing: "Editorbriefing",
  maandrapportage: "Maandrapportages",
  kwartaalrapportage: "Kwartaalrapportages",
  video_analyse: "Video-analyse",
};

const GOOGLE_REAUTH =
  "Zet in Google Cloud (APIs & Services > OAuth consent screen > Audience) de app op 'In production', anders vervalt de toegang elke 7 dagen. " +
  "Verbind daarna opnieuw via Instellingen > Koppelingen met teamshortclips@gmail.com. Drive, Agenda en Gmail delen deze ene toestemming.";

export function systemFor(source: string | null | undefined): string {
  if (!source) return "Portaal";
  const [prefix, rest] = source.split(":");
  if (prefix === "system" && rest) {
    if (rest.startsWith("pandadoc")) return "PandaDoc";
    if (rest.startsWith("awards")) return "Awards (editors)";
    return "Achtergrondtaak";
  }
  if (prefix === "monday" && rest?.startsWith("awards")) return "Awards (editors)";
  if (prefix === "taak") return SYSTEM_BY_TASK[rest ?? ""] ?? "Achtergrondtaak";
  return SYSTEM_BY_PREFIX[prefix ?? ""] ?? "Portaal";
}

export function describeIssue(source: string | null | undefined, message: string): IssueDescription {
  const system = systemFor(source);
  const m = message.toLowerCase();

  if (/invalid_grant|opnieuw toestemming/.test(m) || (/token vernieuwen mislukt/.test(m) && /^(google|gmail)/.test(source ?? ""))) {
    return { system, action: GOOGLE_REAUTH, needsOwner: true };
  }
  if (/ontbrekende configuratie|ontbreekt|nog niet gekoppeld|niet ingesteld/.test(m)) {
    if (system === "Monday (oud)") return { system, action: "Geen actie: Monday is uitgefaseerd. Deze taak draait niet meer.", needsOwner: false };
    return { system, action: "Vul de ontbrekende sleutel in bij Vercel (Environment Variables) en zet daarna opnieuw live.", needsOwner: true };
  }
  if (/adobe ims|frameio_refresh_token/.test(m)) {
    return { system, action: "Verbind Frame.io opnieuw via Instellingen > Koppelingen.", needsOwner: true };
  }
  if (/http 404/.test(m) && system === "Google Agenda") {
    return { system, action: "Geef teamshortclips@gmail.com weer toegang tot deze agenda, of haal hem uit GOOGLE_CALENDAR_IDS.", needsOwner: true };
  }
  if (/http 401|http 403|unauthori[sz]ed|forbidden/.test(m)) {
    return { system, action: "De toegangssleutel wordt geweigerd. Vernieuw de sleutel van deze koppeling en zet hem opnieuw in Vercel.", needsOwner: true };
  }
  if (/credit balance|insufficient|billing|invalid x-api-key|anthropic/.test(m)) {
    return { system, action: "De AI-dienst weigert de aanvraag (tegoed op of sleutel ongeldig). Controleer het Anthropic-account en ANTHROPIC_API_KEY in Vercel.", needsOwner: true };
  }
  if (/overloaded|rate limit|429/.test(m)) {
    return { system, action: "Geen actie: de AI-dienst was tijdelijk overbelast. De taak kan opnieuw gestart worden.", needsOwner: false };
  }
  if (/http 5\d\d|timeout|timed out|econnreset|niet bereikbaar|tijdelijk/.test(m)) {
    return { system, action: "Geen actie: de dienst was tijdelijk onbereikbaar. Het systeem probeert het automatisch opnieuw.", needsOwner: false };
  }
  if (/failed query|duplicate key|violates|syntax error|column .* does not exist/.test(m)) {
    return { system, action: "Fout in de database-opdracht. Laat Claude dit onderdeel onderzoeken en herstellen.", needsOwner: true };
  }
  if (system === "Portaal") {
    return { system, action: "Een pagina of knop gaf een fout. Laat Claude dit onderzoeken; de referentie hoort bij de melding die de medewerker zag.", needsOwner: true };
  }
  return { system, action: "Komt dit vaker terug, laat het dan onderzoeken. Eenmalige fouten herstellen meestal vanzelf bij de volgende run.", needsOwner: false };
}

/** Vervangt id's en lange getallen, zodat dezelfde fout als één melding telt. */
export function normalizeIssueMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "…")
    .replace(/\d{4,}/g, "…")
    .split("\n")[0]!
    .slice(0, 300);
}
