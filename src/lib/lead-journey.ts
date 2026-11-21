import { firstName } from "@/lib/onboarding-plan";

/**
 * Leadreis: van binnenkomende lead tot lopende productie, in 8 fases.
 * Fase 1 t/m 4 leven op de lead zelf. Vanaf fase 5 (klant is aangemaakt)
 * sluit de reis aan op de bestaande klantonboarding en wordt de voortgang
 * daar vandaan gelezen, zodat niets dubbel wordt bijgehouden.
 */

export type JourneyStatus = "nog_niet" | "bezig" | "wacht_klant" | "klaar";

export const STATUS_LABEL: Record<JourneyStatus, string> = {
  nog_niet: "Nog niet gestart",
  bezig: "In behandeling",
  wacht_klant: "Wacht op klant",
  klaar: "Afgerond",
};

/** Wie de fase standaard doet. "owner" = Jarno, "pm" = contactpersoon, "team" = productieteam. */
export type PhaseOwnerRole = "owner" | "pm" | "team";

export type ChecklistItem = {
  key: string;
  label: string;
  /** Sleutel van een feit dat dit punt automatisch afvinkt (zie JourneyFacts). */
  auto?: keyof JourneyFacts;
};

export type PhaseDef = {
  key: string;
  nr: number;
  title: string;
  /** Korte uitleg voor een nieuwe medewerker. */
  explain: string;
  role: PhaseOwnerRole;
  checklist: ChecklistItem[];
  /** Berichtsleutels die bij deze fase horen. */
  messages: string[];
  /** Vanaf deze fase leeft de voortgang in de klantonboarding. */
  clientPhase?: boolean;
};

/** Feiten die live uit de Hub komen en checklistpunten automatisch afvinken. */
export type JourneyFacts = {
  hasContact: boolean;
  hasFollowUp: boolean;
  quoteSent: boolean;
  quoteSigned: boolean;
  clientCreated: boolean;
  whatsappLinked: boolean;
  welcomeSent: boolean;
  kickoffPlanned: boolean;
  kickoffDone: boolean;
  briefingDone: boolean;
  shootsPlanned: boolean;
};

export const emptyFacts: JourneyFacts = {
  hasContact: false,
  hasFollowUp: false,
  quoteSent: false,
  quoteSigned: false,
  clientCreated: false,
  whatsappLinked: false,
  welcomeSent: false,
  kickoffPlanned: false,
  kickoffDone: false,
  briefingDone: false,
  shootsPlanned: false,
};

export const PHASES: PhaseDef[] = [
  {
    key: "binnen",
    nr: 1,
    title: "Lead komt binnen",
    explain: "Een aanvraag staat in de Hub. Controleer de gegevens en neem snel contact op om een kennismakingsgesprek te plannen.",
    role: "owner",
    checklist: [
      { key: "gegevens", label: "Naam, e-mail en telefoon zijn compleet", auto: "hasContact" },
      { key: "bron", label: "Bron en wat de lead zoekt zijn vastgelegd" },
      { key: "contact", label: "Eerste contact is gelegd (mail, telefoon of DM)" },
      { key: "opvolgdatum", label: "Opvolgdatum staat in de Hub", auto: "hasFollowUp" },
    ],
    messages: [],
  },
  {
    key: "kennismaking",
    nr: 2,
    title: "Kennismakingsgesprek",
    explain: "Het gesprek waarin we de wensen, doelen en het budget bespreken en bepalen of we een voorstel maken.",
    role: "owner",
    checklist: [
      { key: "ingepland", label: "Gesprek staat in de agenda" },
      { key: "gevoerd", label: "Gesprek is gevoerd" },
      { key: "notities", label: "Notities en gespreksuitkomst staan bij de lead" },
      { key: "besluit", label: "Besluit genomen: voorstel maken of afsluiten" },
    ],
    messages: [],
  },
  {
    key: "voorstel",
    nr: 3,
    title: "Voorstel versturen",
    explain: "Maak het voorstel in PandaDoc en mail de klant met de link. De status van het voorstel komt vanzelf in de Hub.",
    role: "owner",
    checklist: [
      { key: "gemaakt", label: "Voorstel is gemaakt in PandaDoc" },
      { key: "verstuurd", label: "Voorstel is verstuurd naar de klant", auto: "quoteSent" },
      { key: "mail", label: "Begeleidende mail met PandaDoc-link is verstuurd" },
      { key: "opvolgen", label: "Opvolgmoment staat gepland" },
    ],
    messages: ["voorstel_mail"],
  },
  {
    key: "ondertekend",
    nr: 4,
    title: "Voorstel ondertekend",
    explain: "De klant heeft getekend. Bedank de klant en zet de lead om naar een klant, zodat de onboarding automatisch start.",
    role: "owner",
    checklist: [
      { key: "getekend", label: "Voorstel is ondertekend in PandaDoc", auto: "quoteSigned" },
      { key: "bedankt", label: "Bedankmail is verstuurd" },
      { key: "klant", label: "Lead is omgezet naar klant", auto: "clientCreated" },
    ],
    messages: ["bedankmail"],
  },
  {
    key: "whatsapp",
    nr: 5,
    title: "WhatsAppgroep aanmaken",
    explain: "De vaste lijn met de klant. Maak de groep aan, voeg iedereen toe en stuur het welkomstpakket.",
    role: "pm",
    clientPhase: true,
    checklist: [
      { key: "groep", label: "WhatsAppgroep is aangemaakt", auto: "whatsappLinked" },
      { key: "team", label: "Shortclips-personen zijn toegevoegd" },
      { key: "klant", label: "Klantcontacten zijn toegevoegd" },
      { key: "welkom", label: "Welkomstbericht is verstuurd", auto: "welcomeSent" },
      { key: "bestand", label: "Welkomstbestand is gedeeld" },
      { key: "video", label: "Voorstelvideo van Rutger is gedeeld" },
      { key: "kickofflink", label: "Link om de kickoff te plannen is gedeeld" },
    ],
    messages: ["welkom_whatsapp"],
  },
  {
    key: "kickoff",
    nr: 6,
    title: "Kickoff plannen",
    explain: "In de kickoff bespreken we doelen, doelgroep en stijl en leggen we de eerste drie opnamedagen vast.",
    role: "pm",
    clientPhase: true,
    checklist: [
      { key: "linkverstuurd", label: "Kickofflink is verstuurd", auto: "kickoffPlanned" },
      { key: "ingepland", label: "Kickoff is ingepland", auto: "kickoffPlanned" },
      { key: "afgerond", label: "Kickoff is gehouden", auto: "kickoffDone" },
    ],
    messages: ["kickoff_herinnering"],
  },
  {
    key: "onboarding",
    nr: 7,
    title: "Onboarding naar productie",
    explain: "Na de kickoff maken we de klant productieklaar: briefing, portaaltoegang en de eerste opnamedagen.",
    role: "pm",
    clientPhase: true,
    checklist: [
      { key: "briefing", label: "Klantbriefing staat in het klantgeheugen", auto: "briefingDone" },
      { key: "portaal", label: "Klant is uitgenodigd voor het klantportaal" },
      { key: "opnamedagen", label: "Eerste drie opnamedagen staan in de agenda", auto: "shootsPlanned" },
    ],
    messages: [],
  },
  {
    key: "productie",
    nr: 8,
    title: "Productie loopt",
    explain: "De klant draait mee in het vaste productieproces. Vanaf hier werkt het team met de bestaande Hub-onderdelen.",
    role: "team",
    clientPhase: true,
    checklist: [
      { key: "scripts", label: "Eerste scripts zijn goedgekeurd door de klant" },
      { key: "opnames", label: "Eerste opnamedag is gedraaid" },
      { key: "editing", label: "Eerste video's zijn in editing" },
      { key: "feedback", label: "Feedbackronde is afgerond" },
      { key: "publicatie", label: "Eerste video's zijn gepubliceerd" },
    ],
    messages: [],
  },
];

export const PHASE_BY_KEY = new Map(PHASES.map((p) => [p.key, p]));

/* ------------------------------------------------------------------ *
 * Berichten en links
 * ------------------------------------------------------------------ */

export type MessageDef = { key: string; title: string; hint: string; body: string };

export const MESSAGES: MessageDef[] = [
  {
    key: "voorstel_mail",
    title: "Mail: voorstel versturen",
    hint: "Mail met de PandaDoc-link. Wordt nooit automatisch verstuurd.",
    body: [
      "Hi {voornaam},",
      "",
      "Bedankt voor het fijne kennismakingsgesprek. Op basis van wat we hebben besproken hebben we een voorstel voor {bedrijf} gemaakt.",
      "",
      "Je vindt het voorstel via deze link: {pandadoc_link}",
      "",
      "Heb je vragen of wil je iets doorspreken? Laat het gerust weten, dan plannen we een kort moment.",
      "",
      "Groet,",
      "Team Shortclips",
    ].join("\n"),
  },
  {
    key: "bedankmail",
    title: "Mail: bedankt voor het ondertekenen",
    hint: "Direct na ondertekening. Kondigt de WhatsAppgroep aan.",
    body: [
      "Hi {voornaam},",
      "",
      "Bedankt voor het ondertekenen van het voorstel en voor het vertrouwen in Shortclips. We kijken er echt naar uit om met {bedrijf} aan de slag te gaan.",
      "",
      "Je ontvangt binnenkort een uitnodiging voor een WhatsAppgroep. Daar zetten we alles voor de samenwerking klaar en plannen we samen de kickoff.",
      "",
      "Groet,",
      "Team Shortclips",
    ].join("\n"),
  },
  {
    key: "welkom_whatsapp",
    title: "WhatsApp: welkomstbericht",
    hint: "Eerste bericht in de groep. Voeg het welkomstbestand, de video van Rutger en de kickofflink toe.",
    body: [
      "Hi {voornaam},",
      "",
      "Wat leuk dat we gaan samenwerken, welkom bij Shortclips! Bedankt voor het vertrouwen.",
      "",
      "In deze groep houden we alles kort en snel bij elkaar. Hierboven vind je ons welkomstbestand: {welkomstbestand}",
      "",
      "Rutger heeft ook een korte video voor jullie opgenomen: {rutger_video}",
      "",
      "De volgende stap is de kickoff. Plan hier een moment dat jullie uitkomt: {kickoff_link}",
      "",
      "We kijken uit naar de samenwerking!",
      "",
      "Team Shortclips",
    ].join("\n"),
  },
  {
    key: "kickoff_herinnering",
    title: "WhatsApp: herinnering kickoff plannen",
    hint: "Voor als de kickoff nog niet is gepland.",
    body: [
      "Hi {voornaam},",
      "",
      "Even een vriendelijke herinnering: we plannen graag de kickoff in, zodat we snel kunnen starten met de eerste opnamedagen.",
      "",
      "Je kunt hier een moment kiezen: {kickoff_link}",
      "",
      "Lukt het niet of heb je een vraag? Laat het gerust weten.",
      "",
      "Groet,",
      "Team Shortclips",
    ].join("\n"),
  },
];

export const MESSAGE_BY_KEY = new Map(MESSAGES.map((m) => [m.key, m]));

/** Vaste links die één keer centraal worden ingevuld. Nooit verzonnen: leeg = "nog koppelen". */
export const LINK_DEFS = [
  { key: "kickoff_link", label: "Link om de kickoff te plannen" },
  { key: "rutger_video", label: "Voorstelvideo van Rutger" },
] as const;

export type PlaceholderValues = {
  voornaam?: string | null;
  bedrijf?: string | null;
  pandadoc_link?: string | null;
  kickoff_link?: string | null;
  rutger_video?: string | null;
  welkomstbestand?: string | null;
};

const PLACEHOLDER_LABEL: Record<string, string> = {
  voornaam: "voornaam",
  bedrijf: "bedrijf",
  pandadoc_link: "PandaDoc-link",
  kickoff_link: "kickofflink",
  rutger_video: "video van Rutger",
  welkomstbestand: "welkomstbestand",
};

/**
 * Vult {placeholders} in. Een ontbrekende waarde blijft zichtbaar als
 * [nog koppelen: ...], zodat er nooit een verzonnen of lege link wordt verstuurd.
 */
export function renderMessage(body: string, v: PlaceholderValues): string {
  const first = firstName(v.voornaam ?? null);
  return body.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!(key in PLACEHOLDER_LABEL)) return whole;
    if (key === "voornaam") return first ?? "";
    const val = (v as Record<string, string | null | undefined>)[key];
    return val && val.trim() ? val.trim() : `[nog koppelen: ${PLACEHOLDER_LABEL[key]}]`;
  });
}

/** Resterende [nog koppelen: ...] in een tekst (voor een waarschuwing vóór kopiëren). */
export function missingLinks(text: string): string[] {
  return [...text.matchAll(/\[nog koppelen: ([^\]]+)\]/g)].map((m) => m[1]!);
}

/* ------------------------------------------------------------------ *
 * Voortgang
 * ------------------------------------------------------------------ */

export type PhaseState = { status: JourneyStatus; checks?: Record<string, boolean> };

export function checkValue(item: ChecklistItem, state: PhaseState | undefined, facts: JourneyFacts): boolean {
  if (item.auto && facts[item.auto]) return true;
  return Boolean(state?.checks?.[item.key]);
}

export function phaseProgress(def: PhaseDef, state: PhaseState | undefined, facts: JourneyFacts): { done: number; total: number } {
  const total = def.checklist.length;
  const done = def.checklist.filter((c) => checkValue(c, state, facts)).length;
  return { done, total };
}

/**
 * Effectieve status van een fase. "klaar" is een bewuste klik. De volgende
 * fase na de laatste afgeronde wordt automatisch "in behandeling" zodra er
 * werk in zit; anders blijft hij "nog niet gestart".
 */
export function effectiveStatus(def: PhaseDef, states: Record<string, PhaseState | undefined>, facts: JourneyFacts): JourneyStatus {
  const own = states[def.key];
  if (own?.status === "klaar") return "klaar";
  const idx = PHASES.findIndex((p) => p.key === def.key);
  const prevDone = idx === 0 || PHASES.slice(0, idx).every((p) => states[p.key]?.status === "klaar");
  if (own?.status === "wacht_klant") return "wacht_klant";
  if (own?.status === "bezig") return "bezig";
  if (prevDone) {
    const p = phaseProgress(def, own, facts);
    return p.done > 0 || idx === 0 ? "bezig" : "nog_niet";
  }
  return "nog_niet";
}

/** Eerste fase die nog niet klaar is = waar de lead nu staat. */
export function currentPhase(states: Record<string, PhaseState | undefined>): PhaseDef | null {
  return PHASES.find((p) => states[p.key]?.status !== "klaar") ?? null;
}

/** Titel van de taak die bij de huidige fase hoort (zichtbaar in het takenoverzicht). */
export function journeyTaskTitle(company: string, def: PhaseDef): string {
  return `${company}: fase ${def.nr}, ${def.title}`;
}

export function journeyTaskDedupe(leadId: string, phaseKey: string): string {
  return `journey:${leadId}:${phaseKey}`;
}
