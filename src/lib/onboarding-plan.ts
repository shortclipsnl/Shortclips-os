/**
 * Klantonboarding: de vaste regels, los van database en UI (zodat ze getest
 * kunnen worden). Wie wat ziet en wanneer een stap "klaar" is, staat hier.
 */

/**
 * De onboardingchecklist in vier fases. `required`: de onboarding kan pas
 * afgerond worden als deze stap klaar is (of door Jarno bewust is uitgezet).
 * Niet-verplichte stappen kan de projectmanager per klant uitzetten.
 */
export const ONBOARDING_PHASES = [
  { key: 1, label: "Administratie en klantgegevens" },
  { key: 2, label: "Projectomgeving" },
  { key: 3, label: "Communicatie" },
  { key: 4, label: "Kickoff en eerste opname" },
] as const;

export type StepWho = "Automatisch" | "Projectmanager" | "Deels automatisch";

export const ONBOARDING_STEPS = [
  { key: "contract", phase: 1, label: "Offerte ondertekend in PandaDoc", who: "Automatisch", required: true },
  { key: "client_data", phase: 1, label: "Klantgegevens compleet", who: "Projectmanager", required: true },
  { key: "pm_linked", phase: 1, label: "Projectmanager toegewezen", who: "Automatisch", required: true },
  { key: "portal_invite", phase: 1, label: "Klantportaal login aangemaakt", who: "Projectmanager", required: true },
  { key: "drive", phase: 2, label: "Google Drive-map met submappen", who: "Automatisch", required: true },
  { key: "frame", phase: 2, label: "Frame.io project gekoppeld", who: "Deels automatisch", required: true },
  { key: "tasks", phase: 2, label: "Taken en deadlines aangemaakt", who: "Automatisch", required: false },
  { key: "welcome_msg", phase: 3, label: "Welkomstbericht voorbereid", who: "Automatisch", required: false },
  { key: "welcome_file", phase: 3, label: "Welkomstbestand gekoppeld", who: "Automatisch", required: false },
  { key: "whatsapp", phase: 3, label: "WhatsApp groep aangemaakt", who: "Projectmanager", required: true },
  { key: "welcome_sent", phase: 3, label: "Welkomstbericht en -bestand verstuurd", who: "Projectmanager", required: true },
  { key: "portal_used", phase: 3, label: "Klant heeft ingelogd op het portaal", who: "Automatisch", required: false },
  { key: "kickoff", phase: 4, label: "Kickoff ingepland", who: "Deels automatisch", required: true },
  { key: "briefing", phase: 4, label: "Klantbriefing in het klantgeheugen", who: "Projectmanager", required: true },
  { key: "first_shoot", phase: 4, label: "Eerste 3 opnamedagen gepland", who: "Deels automatisch", required: true },
] as const satisfies readonly { key: string; phase: number; label: string; who: StepWho; required: boolean }[];

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"] | "done";
export type StepStatus = "klaar" | "open" | "wacht" | "mislukt" | "bezig" | "uit";

/** Aantal opnamedagen dat in de kickoff vast moet liggen (vaste werkwijze). */
export const FIRST_SHOOTS_REQUIRED = 3;

/** Briefingvelden: komen als losse regels in het klantgeheugen (client_knowledge). */
export const BRIEFING_FIELDS = [
  { key: "goal", category: "goal", title: "Doelstellingen", required: true, placeholder: "Wat moet short video opleveren? Bijv. meer aanvragen, naamsbekendheid in de regio, personeel werven." },
  { key: "audience", category: "audience", title: "Doelgroep", required: true, placeholder: "Wie willen we bereiken? Leeftijd, regio, beroep, wat speelt er bij hen." },
  { key: "tone", category: "tone_of_voice", title: "Tone of voice", required: false, placeholder: "Hoe praat het merk? Bijv. nuchter, deskundig, met humor." },
  { key: "products", category: "products", title: "Producten en diensten", required: false, placeholder: "Wat verkopen ze en wat moet extra aandacht krijgen?" },
  { key: "competitors", category: "competitor", title: "Concurrenten", required: false, placeholder: "Namen of accounts, en wat de klant daarvan vindt." },
  { key: "brand", category: "brand_identity", title: "Merkidentiteit", required: false, placeholder: "Kleuren, uitstraling, kernwaarden, wat past niet bij het merk." },
  { key: "preferences", category: "content_preference", title: "Contentvoorkeuren", required: false, placeholder: "Wie komt in beeld, wat wel en niet, voorbeelden die ze goed vinden." },
  { key: "agreements", category: "fact", title: "Afspraken en bijzonderheden", required: false, placeholder: "Vaste afspraken, publicatie, goedkeuring, bijzonderheden." },
] as const;
export const BRIEFING_SOURCE = "onboarding";

/** De standaard mappenstructuur van een klantmap in Drive (zoals KUBO). */
export const DRIVE_SUBFOLDERS = [
  "1. SHORT VIDEO STRATEGIE",
  "2. SHORT VIDEO SCRIPTS",
  "3. BRANDING",
  "4. MEETINGS",
  "5. CONTENT PLANNING",
  "6. STATISTIEKEN",
  "7. OVERIGE BESTANDEN- NOTITIES",
] as const;

/** Welkomstbestanden in Drive (map "4. WELKOM BIJ SHORTCLIPS (Na offerte akkoord)"). */
export const WELCOME_FILES = {
  organisch: { id: "12b1vEiUiBZrVul4X3Nul-6dnYbe0B5-z", name: "Welkombestand organisch 2026" },
  advertentie: { id: "1u3LVSTd5bre_E4bGW4alQicqVxWxKfHw", name: "Welkombestand advertentie 2026" },
} as const;

export const PAKKETTEN = [
  { value: "org6", label: "6 shorts organisch", shorts: 6, focus: "organisch" },
  { value: "org8", label: "8 shorts organisch", shorts: 8, focus: "organisch" },
  { value: "ads6", label: "6 shorts advertenties", shorts: 6, focus: "advertentie" },
  { value: "ads8", label: "8 shorts advertenties", shorts: 8, focus: "advertentie" },
] as const;

/** Mapnaam in Drive: zoals de bestaande mappen, in hoofdletters. */
export function driveFolderName(clientName: string): string {
  return clientName.replace(/\s+/g, " ").trim().toUpperCase();
}

/** Naam vergelijkbaar maken: kleine letters, zonder rechtsvorm en leestekens. */
export function normalizeCompany(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|holding|groep|group)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * Lijkt deze naam op een bestaande klant? Gelijk na normaliseren, de een bevat
 * de ander (minimaal 4 tekens), of hooguit 2 tekens verschil bij namen vanaf 6
 * tekens. Bewust ruim: een waarschuwing te veel is goedkoper dan een dubbele klant.
 */
export function isSimilarCompany(a: string, b: string): boolean {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  if (short.length >= 4 && long.includes(short)) return true;
  if (short.length >= 6 && levenshtein(x, y) <= 2) return true;
  return false;
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Het persoonlijke welkomstbericht (concept, wordt nooit automatisch verstuurd). */
export function buildWelcomeMessage(input: { contactName: string | null; pmName: string | null; publisher?: "shortclips" | "klant"; kickoffLabel?: string | null }): string {
  const aanhef = firstName(input.contactName) ? `Hi ${firstName(input.contactName)},` : "Hi,";
  const pm = firstName(input.pmName);
  const nodig = ["logo en huisstijl (kleuren en lettertype)"];
  if (input.publisher !== "klant") nodig.push("toegang tot de social media kanalen waarop wij publiceren");
  nodig.push("eventueel voorbeelden van video's die jullie aanspreken");
  return [
    aanhef,
    "",
    "Wat leuk dat we gaan samenwerken, welkom bij Shortclips! Bedankt voor het vertrouwen.",
    "",
    pm
      ? `${pm} wordt jullie vaste contactpersoon en begeleidt jullie tijdens de hele samenwerking.`
      : "Jullie krijgen een vaste contactpersoon die jullie tijdens de hele samenwerking begeleidt.",
    "",
    "Zo werken we: we starten met een kickoff waarin we jullie doelen, doelgroep en stijl bespreken en direct de eerste opnamedagen vastleggen. Daarna schrijven we de scripts, die jullie vooraf goedkeuren. Na de opname leveren we de video's binnen 14 werkdagen aan.",
    "",
    "In het klantportaal vinden jullie alles terug: scripts, opnames, video's, contentplanning en resultaten. De uitnodiging voor het portaal ontvangen jullie per mail.",
    "",
    `Wat we graag van jullie ontvangen: ${nodig.slice(0, -1).join(", ")} en ${nodig[nodig.length - 1]}.`,
    "",
    input.kickoffLabel ? `We zien jullie graag bij de kickoff op ${input.kickoffLabel}.` : "Als eerstvolgende stap plannen we samen de kickoff.",
    "",
    "We kijken uit naar de samenwerking!",
    "",
    "Team Shortclips",
  ].join("\n");
}

/** Voorbereide WhatsApp-groepsnaam (zoals de bestaande groepen). */
export function whatsappGroupName(clientName: string): string {
  return `Shortclips x ${clientName.replace(/\s+/g, " ").trim()}`;
}

/** Alleen echte WhatsApp-groepslinks opslaan. */
export function isWhatsappGroupLink(input: string): boolean {
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,}$/.test(input.trim());
}

/** Kickoff in de agenda herkennen aan de titel ("Kickoff", "Kick-off", "Kick off"). */
export function isKickoffTitle(title: string | null | undefined): boolean {
  return /\bkick[\s-]?off\b/i.test(title ?? "");
}

/** De taken die de projectmanager krijgt. `daysAfter` = werkdagen na omzetten. */
export const ONBOARDING_TASKS = [
  { key: "whatsapp", title: (c: string) => `WhatsAppgroep aanmaken voor ${c}`, daysAfter: 0, step: "whatsapp" },
  { key: "frame", title: (c: string) => `Frame.io project aanmaken voor ${c}`, daysAfter: 0, step: "frame" },
  { key: "welkomstbericht", title: (c: string) => `Welkomstbericht en -bestand versturen aan ${c}`, daysAfter: 0, step: "welcome_sent" },
  { key: "portaal", title: (c: string) => `Contactpersoon ${c} uitnodigen voor het klantportaal`, daysAfter: 1, step: "portal_invite" },
  { key: "kickoff", title: (c: string) => `Kickoff inplannen met ${c}`, daysAfter: 3, step: "kickoff" },
  { key: "briefing", title: (c: string) => `Klantbriefing invullen voor ${c}`, daysAfter: 5, step: "briefing" },
  { key: "opnamedag", title: (c: string) => `Eerste 3 opnamedagen plannen met ${c}`, daysAfter: 5, step: "first_shoot" },
] as const;

export type OnboardingTaskKey = (typeof ONBOARDING_TASKS)[number]["key"];

export function onboardingTaskDedupe(clientId: string, key: string): string {
  return `onboarding:${clientId}:${key}`;
}

/** Feiten waaruit de voortgang wordt afgeleid. */
export type OnboardingFacts = {
  /** PandaDoc: "ondertekend" (getekend/geaccepteerd), "open" (offerte loopt), "geen". */
  contract: "ondertekend" | "open" | "geen";
  contractManual?: boolean;
  missingClientData: string[];
  hasCoordinator: boolean;
  hasPortalLogin: boolean;
  driveStatus: "klaar" | "mislukt" | "bezig" | "open";
  driveError?: string | null;
  frameLinked: boolean;
  frameManual?: boolean;
  tasksCreated: boolean;
  hasWelcomeMessage: boolean;
  hasWelcomeFile: boolean;
  whatsappDone: boolean;
  hasPhone: boolean;
  welcomeSent: boolean;
  portalUsed: boolean;
  kickoff: { at: string | null; source: "agenda" | "handmatig" | null };
  briefingMissing: string[];
  briefingTouched: boolean;
  shoots: number;
  /** Stappen die voor deze klant uit staan. */
  disabled: string[];
};

export type StepView = {
  key: OnboardingStepKey;
  phase: number;
  label: string;
  who: string;
  required: boolean;
  status: StepStatus;
  detail: string | null;
};

export type PhaseView = { key: number; label: string; done: number; total: number; status: "klaar" | "open" | "wacht" | "mislukt" | "bezig" };

const STATUS_RANK: Record<StepStatus, number> = { mislukt: 4, wacht: 3, bezig: 2, open: 1, klaar: 0, uit: -1 };

export function computeSteps(f: OnboardingFacts): {
  steps: StepView[];
  phases: PhaseView[];
  done: number;
  total: number;
  requiredOpen: StepView[];
  needsAction: boolean;
  complete: boolean;
} {
  const s: Record<string, { status: StepStatus; detail: string | null }> = {
    contract:
      f.contract === "ondertekend" || f.contractManual
        ? { status: "klaar", detail: f.contractManual && f.contract !== "ondertekend" ? "Handmatig bevestigd." : null }
        : f.contract === "open"
          ? { status: "wacht", detail: "Offerte loopt in PandaDoc. Gaat vanzelf op klaar zodra die is ondertekend." }
          : { status: "open", detail: "Geen offerte gekoppeld aan deze lead. Koppel hem bij Offertes of bevestig handmatig." },
    client_data: f.missingClientData.length
      ? { status: "open", detail: `Nog aanvullen: ${f.missingClientData.join(", ")}.` }
      : { status: "klaar", detail: null },
    pm_linked: { status: f.hasCoordinator ? "klaar" : "mislukt", detail: f.hasCoordinator ? null : "Nog geen projectmanager gekozen." },
    portal_invite: { status: f.hasPortalLogin ? "klaar" : "open", detail: f.hasPortalLogin ? null : "Maak de login aan bij Beheer van deze klant." },
    drive: {
      status: f.driveStatus === "klaar" ? "klaar" : f.driveStatus === "mislukt" ? "mislukt" : f.driveStatus === "bezig" ? "bezig" : "open",
      detail: f.driveStatus === "mislukt" ? f.driveError ?? "Aanmaken mislukt." : null,
    },
    frame: f.frameLinked || f.frameManual
      ? { status: "klaar", detail: !f.frameLinked ? "Handmatig bevestigd." : null }
      : { status: "open", detail: "Nog geen Frame.io project gekoppeld." },
    tasks: { status: f.tasksCreated ? "klaar" : "open", detail: null },
    welcome_msg: { status: f.hasWelcomeMessage ? "klaar" : "open", detail: null },
    welcome_file: { status: f.hasWelcomeFile ? "klaar" : "open", detail: null },
    whatsapp: f.whatsappDone
      ? { status: "klaar", detail: null }
      : f.hasPhone
        ? { status: "open", detail: "Groep aanmaken in WhatsApp Business en de groepslink hier opslaan." }
        : { status: "wacht", detail: "Telefoonnummer contactpersoon ontbreekt." },
    welcome_sent: { status: f.welcomeSent ? "klaar" : "open", detail: f.welcomeSent ? null : "Na het aanmaken van de WhatsApp groep." },
    portal_used: { status: f.portalUsed ? "klaar" : f.hasPortalLogin ? "wacht" : "open", detail: f.portalUsed ? null : f.hasPortalLogin ? "Wacht op de eerste login van de klant." : null },
    kickoff: f.kickoff.at
      ? { status: "klaar", detail: `${f.kickoff.source === "agenda" ? "In de agenda" : "Handmatig vastgelegd"}: ${f.kickoff.at}` }
      : { status: "open", detail: "Nog geen kickoff in de agenda gevonden." },
    briefing: !f.briefingMissing.length
      ? { status: "klaar", detail: null }
      : { status: "open", detail: f.briefingTouched ? `Nog invullen: ${f.briefingMissing.join(", ")}.` : "Vul de briefing in tijdens of na de kickoff." },
    first_shoot:
      f.shoots >= FIRST_SHOOTS_REQUIRED
        ? { status: "klaar", detail: `${f.shoots} opnamedagen gepland.` }
        : { status: f.shoots > 0 ? "bezig" : "open", detail: `${f.shoots} van ${FIRST_SHOOTS_REQUIRED} opnamedagen in de agenda.` },
  };

  const steps: StepView[] = ONBOARDING_STEPS.map((x) => {
    const off = f.disabled.includes(x.key);
    return { key: x.key, phase: x.phase, label: x.label, who: x.who, required: x.required, status: off ? "uit" : s[x.key]!.status, detail: off ? "Uitgezet voor deze klant." : s[x.key]!.detail };
  });
  const active = steps.filter((x) => x.status !== "uit");
  const requiredOpen = active.filter((x) => x.required && x.status !== "klaar");
  const complete = requiredOpen.length === 0;
  steps.push({ key: "done", phase: 4, label: "Onboarding afgerond", who: "Automatisch", required: false, status: complete ? "klaar" : "open", detail: complete ? null : `Nog ${requiredOpen.length} verplichte ${requiredOpen.length === 1 ? "stap" : "stappen"} open.` });

  const phases: PhaseView[] = ONBOARDING_PHASES.map((p) => {
    const its = active.filter((x) => x.phase === p.key);
    const done = its.filter((x) => x.status === "klaar").length;
    const worst = its.reduce<StepStatus>((w, x) => (STATUS_RANK[x.status] > STATUS_RANK[w] ? x.status : w), "klaar");
    const status = done === its.length ? "klaar" : worst === "mislukt" ? "mislukt" : worst === "wacht" ? "wacht" : done > 0 ? "bezig" : "open";
    return { key: p.key, label: p.label, done, total: its.length, status };
  });

  const done = active.filter((x) => x.status === "klaar").length;
  const needsAction = active.some((x) => x.status === "mislukt");
  return { steps, phases, done, total: active.length, requiredOpen, needsAction, complete };
}

/** Mag deze stap per klant uit? Verplichte stappen alleen door de eigenaar. */
export function canDisableStep(key: string, isOwner: boolean): boolean {
  const st = ONBOARDING_STEPS.find((x) => x.key === key);
  if (!st || key === "pm_linked") return false;
  return isOwner || !st.required;
}

/** Signalen bij vertraging: stap, na hoeveel werkdagen, escaleren naar Jarno. */
export const LATE_SIGNALS = [
  { step: "whatsapp", afterWorkdays: 2, label: "WhatsApp groep nog niet aangemaakt", escalate: false },
  { step: "kickoff", afterWorkdays: 5, label: "Nog geen kickoff ingepland", escalate: false },
  { step: "first_shoot", afterWorkdays: 10, label: "Eerste opnamedagen nog niet gepland", escalate: true },
] as const;

/** Tijdelijke fout (opnieuw proberen zinvol) of blijvende fout. */
export function isTransientError(e: unknown): boolean {
  const any = e as { status?: number; retryable?: boolean; code?: string } | null;
  if (any?.retryable === true) return true;
  const s = any?.status;
  if (typeof s === "number" && [408, 429, 500, 502, 503, 504].includes(s)) return true;
  return ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(any?.code ?? "");
}

/** Probeert `fn` maximaal `max` keer bij tijdelijke fouten (2s, 4s wachten). */
export async function withRetry<T>(fn: () => Promise<T>, max = 3, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<{ value: T; attempts: number }> {
  for (let i = 1; ; i++) {
    try {
      return { value: await fn(), attempts: i };
    } catch (e) {
      if (!isTransientError(e) || i >= max) {
        (e as { attempts?: number }).attempts = i;
        throw e;
      }
      await wait(1000 * 2 ** i);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Vervolgmomenten na de onboarding
 * ------------------------------------------------------------------ */

export type FollowupKey = "factuur" | "tevredenheid" | "evaluatie_1m" | "verlenging";

export type FollowupPlan = {
  key: FollowupKey;
  /** Korte naam voor het overzicht. */
  label: string;
  title: string;
  description: string;
  /** Wie: projectmanager of de facturatie-eigenaar. */
  owner: "pm" | "facturatie";
  dueOn: string;
  /** Vanaf deze dag staat de taak op Vandaag/Taken (niet maanden vooruit). */
  showFrom: string;
};

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonthsKeepDay(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

/** Eerstvolgende vrijdag op of na deze datum (weekronde facturatie). */
export function nextFriday(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const add = (5 - d.getUTCDay() + 7) % 7;
  return addDays(dateStr, add);
}

/** Werkdag op of vóór deze datum (zaterdag/zondag → vrijdag). */
function workdayOnOrBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return d === 6 ? addDays(dateStr, -1) : d === 0 ? addDays(dateStr, -2) : dateStr;
}

/**
 * De vervolgmomenten van een nieuwe klant, als vaste regels:
 * - eerste factuur in de eerstvolgende weekronde (vrijdag) na het omzetten;
 * - evaluatie na de eerste maand (Shortclips evaluatiebestand, 1 maand);
 * - klanttevredenheid peilen zes weken na de start;
 * - verlenging bespreken vóór de opzegdeadline (einddatum min opzegtermijn
 *   min een week), alleen bij een contract met einddatum.
 */
export function planFollowups(input: {
  clientName: string;
  convertedOn: string;
  startOn: string;
  endsOn: string | null;
  noticeDays: number;
}): FollowupPlan[] {
  const c = input.clientName;
  const out: FollowupPlan[] = [];

  const factuur = nextFriday(input.convertedOn);
  out.push({
    key: "factuur",
    label: "Eerste factuur (weekronde)",
    title: `Eerste factuur ${c} meenemen in de weekronde`,
    description: `Nieuwe klant, start ${input.startOn}. Maandbedrag en contract staan bij Contract & facturatie. Factuur in de weekronde van vrijdag.`,
    owner: "facturatie",
    dueOn: factuur,
    showFrom: input.convertedOn,
  });

  const eval1 = workdayOnOrBefore(addMonthsKeepDay(input.startOn, 1));
  out.push({
    key: "evaluatie_1m",
    label: "Evaluatie na de eerste maand",
    title: `Evaluatie na de eerste maand voorbereiden voor ${c}`,
    description: "Maak het evaluatiebestand (1 maand) met de statistieken en plan het evaluatiemoment met de klant.",
    owner: "pm",
    dueOn: eval1,
    showFrom: addDays(eval1, -7),
  });

  const tevreden = workdayOnOrBefore(addDays(input.startOn, 42));
  out.push({
    key: "tevredenheid",
    label: "Klanttevredenheid peilen",
    title: `Klanttevredenheid peilen bij ${c}`,
    description: "Kort contactmoment: hoe ervaart de klant de samenwerking, scripts en video's tot nu toe? Leg feedback vast bij Klantbehoud.",
    owner: "pm",
    dueOn: tevreden,
    showFrom: addDays(tevreden, -5),
  });

  if (input.endsOn) {
    const deadline = addDays(input.endsOn, -input.noticeDays);
    const due = workdayOnOrBefore(addDays(deadline, -7));
    out.push({
      key: "verlenging",
      label: "Verlenging bespreken",
      title: `Verlenging bespreken met ${c}`,
      description: `Contract loopt tot ${input.endsOn}, opzegdeadline ${deadline}. Bereid de evaluatie voor en bespreek de verlenging ruim vóór de deadline.`,
      owner: "pm",
      dueOn: due,
      showFrom: addDays(due, -14),
    });
  }

  // Een moment dat vóór het omzetten zou liggen, schuift naar de omzetdag.
  return out.map((f) => (f.dueOn < input.convertedOn ? { ...f, dueOn: input.convertedOn, showFrom: input.convertedOn } : f));
}
