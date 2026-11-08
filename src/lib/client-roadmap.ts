import { addWorkingDays, workingDaysUntil } from "./workdays";
import { amsterdamDay, clientFeedbackDue } from "./client-feedback";

/**
 * Klantroadmap — pure afleiding (geen database, geen klok behalve `today`).
 *
 * De roadmap is uitsluitend een WEERGAVE van bestaande productiegegevens. Er is
 * geen eigen status en niets om handmatig bij te houden: elke keer dat het
 * portaal opent, rekenen we de fase per opnamesessie opnieuw uit. Daardoor
 * volgen teruggedraaide statussen, verplaatste opnamedagen en heropende video's
 * vanzelf.
 *
 * Bronnen (alleen velden die aantoonbaar worden bijgehouden):
 *  - opnamesessie   = production_days (uit Google Agenda; geannuleerd telt niet)
 *  - scripts        = script_reviews (portaal) en anders production_days.scripting_status
 *  - montage/feedback = de editingstatus per sessie (deliverables.status)
 *  - video's        = aantal Frame.io-bestanden in de sessiemap
 *
 * Bewust NIET gebruikt: production_days.edit_status (wordt niet bijgehouden) en
 * content_calendar.status = published (wordt automatisch gezet zodra de datum
 * voorbij is, dus geen bewijs van publicatie).
 */

export type StepKey = "scripts" | "opname" | "montage" | "feedback" | "klaar";
/** done = groen · active = blauw (Shortclips is bezig) · action = oranje (klant
 *  aan zet) · blocked = rood (termijn verstreken) · future = grijs. */
export type StepState = "done" | "active" | "action" | "blocked" | "future";
export type RoadmapTone = "green" | "blue" | "orange" | "red" | "grey";

export const STATE_TONE: Record<StepState, RoadmapTone> = {
  done: "green",
  active: "blue",
  action: "orange",
  blocked: "red",
  future: "grey",
};

export type RoadmapStep = { key: StepKey; label: string; state: StepState };

export type SessionInput = {
  id: string;
  /** Opnamedatum YYYY-MM-DD. */
  shootOn: string;
  /** "HH:MM" of "HH:MM:SS". */
  startTime: string | null;
  locationName: string | null;
  /** production_days.status (planned/confirmed/…/cancelled). */
  dayStatus: string;
  /** production_days.scripting_status (teamstatus). */
  scriptingStatus: string;
  scriptReview: {
    id: string;
    status: string;
    /** Expliciete deadline van het team (ISO), als die is gezet. */
    feedbackDeadline: string | null;
    /** Moment waarop de huidige versie naar de klant ging (ISO). */
    sentAt: string | null;
  } | null;
  /** De voor de klant belangrijkste editingregel van deze sessie. */
  edit: {
    status: string;
    statusChangedAt: string;
    dueOn: string | null;
    /** "manual" = door het team gezet; anders automatisch berekend. */
    dueOnSource: string | null;
  } | null;
  /** Aantal video's in de Frame.io-sessiemap. */
  videoCount: number;
  /** Sleutel van de sessie in de videobibliotheek (voor de directe link). */
  frameSessionKey: string | null;
};

export type ClientInput = {
  clientStatus: string;
  weHandlePosting: boolean;
  /** Vandaag in Amsterdam, YYYY-MM-DD. */
  today: string;
  feedbackDaysScripts: number;
  feedbackDaysVideos: number;
  deliveryWorkdays: number;
  holidays?: ReadonlySet<string>;
  /** Eerstvolgende door de klant goedgekeurde/gedeelde publicatie (planning). */
  nextPlannedOn: string | null;
  plannedCount: number;
  /** Laatste aantoonbare publicatie (met post-URL/tijdstip uit de koppeling). */
  lastConfirmedOn: string | null;
  confirmedLast30: number;
};

export type RoadmapAction = {
  label: string;
  href: string;
};

export type SessionRoadmap = {
  id: string;
  shootOn: string;
  title: string;
  steps: RoadmapStep[];
  current: StepKey;
  state: StepState;
  /** Korte statustekst voor de sessiekaart. */
  statusLabel: string;
  headline: string;
  detail: string;
  /** Uiterste reactiedatum voor de klant (YYYY-MM-DD) — alleen als de klant aan zet is. */
  deadline: string | null;
  /** Verwachte oplevering (YYYY-MM-DD) — alleen als die betrouwbaar te bepalen is. */
  expectedOn: string | null;
  action: RoadmapAction | null;
  /** Hoe belangrijk deze sessie nu is voor "Wat gebeurt er nu?". */
  priority: number;
  /** Afgerond of te oud om iets zinnigs over te zeggen → uit het overzicht. */
  archived: boolean;
};

export type InternalIssue = {
  sessionId: string | null;
  severity: "info" | "warn" | "escalate";
  message: string;
};

export type NextAction = {
  tone: RoadmapTone;
  headline: string;
  detail: string;
  deadline: string | null;
  expectedOn: string | null;
  action: RoadmapAction | null;
  sessionId: string | null;
};

export type PublicationStrip = {
  mode: "shortclips" | "self";
  nextPlannedOn: string | null;
  plannedCount: number;
  lastConfirmedOn: string | null;
  confirmedLast30: number;
};

export type ClientRoadmap = {
  next: NextAction;
  /** Overige openstaande klantacties (naast de hoofdactie), max. 3. */
  alsoForYou: NextAction[];
  sessions: SessionRoadmap[];
  archivedCount: number;
  publication: PublicationStrip | null;
  /** Alleen voor het team — nooit naar de klant sturen. */
  issues: InternalIssue[];
  /** Klant heeft geen lopende samenwerking: geen tijdlijn en geen acties. */
  inactive: boolean;
};

/* ------------------------------------------------------------------ */

const PROD = new Set(["recorded", "footage_upload", "awaiting_editor", "editing", "internal_review", "editor_revision"]);
const DONE = new Set(["approved", "ready_to_publish", "scheduled", "published", "analysis_available"]);
const SCRIPT_AT_CLIENT_REVIEW = new Set(["klaar_controle", "opnieuw_controle"]);
const SCRIPT_PROCESSING_REVIEW = new Set(["feedback_gegeven", "wordt_aangepast"]);
const SCRIPTING_AT_CLIENT = new Set(["scripts_bij_klant", "afwachting_klant"]);

/** Afgeronde sessie blijft zoveel kalenderdagen zichtbaar, daarna archief. */
export const ARCHIVE_AFTER_DAYS = 14;
/** Oudere sessies die nog "in productie" staan zijn vrijwel zeker niet bijgewerkt. */
export const STALE_AFTER_DAYS = 45;
/** Scripts voor een opname verder weg dan dit tonen we nog als toekomstige stap. */
const SCRIPT_HORIZON_DAYS = 28;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const WEEKDAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

/** "donderdag 12 november" — vaste Nederlandse notatie, tijdzone-onafhankelijk. */
export function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "12 november" */
export function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
function hhmm(t: string | null): string | null {
  return t ? t.slice(0, 5) : null;
}

function videosWord(n: number): string {
  return n === 1 ? "video" : "video's";
}

/* ------------------------------------------------------------------ */

/** Leidt de roadmap van één opnamesessie af. Geannuleerde sessies → null. */
export function deriveSession(s: SessionInput, c: ClientInput, issues: InternalIssue[] = []): SessionRoadmap | null {
  if (s.dayStatus === "cancelled") return null;
  const today = c.today;
  const shootPast = s.shootOn < today;
  const shootToday = s.shootOn === today;
  const shotHappened = shootPast || shootToday;
  const daysToShoot = daysBetween(today, s.shootOn);
  const daysSinceShoot = -daysToShoot;
  const posting = c.weHandlePosting;

  // De editingstatus telt alleen na de opname; vóór de opname staat er vaak al
  // een lege regel ("recorded") klaar.
  const edit = shootPast ? s.edit : null;
  const ed = edit?.status ?? null;

  const steps: Record<StepKey, StepState> = { scripts: "future", opname: "future", montage: "future", feedback: "future", klaar: "future" };
  let scriptDeadline: string | null = null;
  let scriptMode: "review" | "processing" | "offline" | "prep" | "done" | "later" = "later";

  /* Scripts */
  const r = s.scriptReview;
  if (shotHappened) {
    steps.scripts = "done";
    scriptMode = "done";
    if (r && SCRIPT_AT_CLIENT_REVIEW.has(r.status) && shootPast) {
      issues.push({ sessionId: s.id, severity: "info", message: "Scriptreview staat nog open terwijl de opname al geweest is. Zet de review op goedgekeurd of archiveer hem." });
    }
  } else if (r && SCRIPT_AT_CLIENT_REVIEW.has(r.status)) {
    scriptMode = "review";
    scriptDeadline = r.feedbackDeadline
      ? amsterdamDay(r.feedbackDeadline)
      : r.sentAt
        ? clientFeedbackDue(r.sentAt, c.feedbackDaysScripts, c.holidays)
        : null;
    steps.scripts = scriptDeadline && today > scriptDeadline ? "blocked" : "action";
  } else if (r && SCRIPT_PROCESSING_REVIEW.has(r.status)) {
    scriptMode = "processing";
    steps.scripts = "active";
  } else if ((r && r.status === "goedgekeurd") || s.scriptingStatus === "final") {
    scriptMode = "done";
    steps.scripts = "done";
  } else if (SCRIPTING_AT_CLIENT.has(s.scriptingStatus)) {
    // Het team heeft de scripts buiten het portaal naar de klant gestuurd: wel
    // klant aan zet, maar zonder knop naar een review die niet bestaat.
    scriptMode = "offline";
    steps.scripts = "action";
    issues.push({ sessionId: s.id, severity: "info", message: "Scriptingstatus staat op 'bij klant', maar er staat geen scriptreview in het portaal. Upload de scripts als review, dan kan de klant direct akkoord geven." });
  } else if (daysToShoot <= SCRIPT_HORIZON_DAYS) {
    scriptMode = "prep";
    steps.scripts = "active";
  } else {
    scriptMode = "later";
    steps.scripts = "future";
  }

  /* Opname */
  if (shootPast) steps.opname = "done";
  else if (shootToday) steps.opname = "active";
  else if (steps.scripts === "done") steps.opname = "active";

  /* Montage / feedback / klaar */
  let expectedOn: string | null = null;
  let feedbackDeadline: string | null = null;
  let delayed = false;
  let stale = false;
  if (shootPast) {
    if (!ed || PROD.has(ed)) {
      steps.montage = "active";
      if (daysSinceShoot > STALE_AFTER_DAYS) {
        // Zo lang na de opname zonder afgeronde status: vrijwel zeker niet
        // bijgewerkt. Niet aan de klant tonen (geen verkeerde "in montage").
        stale = true;
        issues.push({ sessionId: s.id, severity: "info", message: `Opname van ${daysSinceShoot} dagen geleden heeft geen afgeronde editingstatus. De sessie is voor de klant verborgen; zet de status op goedgekeurd als de video's al zijn opgeleverd.` });
      } else if (edit) {
        expectedOn = edit.dueOnSource === "manual" && edit.dueOn
          ? edit.dueOn
          : addWorkingDays(s.shootOn, c.deliveryWorkdays, c.holidays);
        if (expectedOn < today) {
          delayed = true;
          issues.push({ sessionId: s.id, severity: "escalate", message: `Montage loopt over de klantoplevering (${shortDate(expectedOn)}). De klant ziet "duurt iets langer", zonder datum.` });
          expectedOn = null;
        }
      } else {
        issues.push({ sessionId: s.id, severity: "warn", message: "Opname is geweest, maar er is geen editingproject. De klant ziet 'in montage' zonder verwachte datum." });
      }
    } else if (ed === "client_review") {
      steps.montage = "done";
      feedbackDeadline = clientFeedbackDue(edit!.statusChangedAt, c.feedbackDaysVideos, c.holidays);
      steps.feedback = today > feedbackDeadline ? "blocked" : "action";
      if (steps.feedback === "blocked") {
        issues.push({ sessionId: s.id, severity: "escalate", message: `Feedbacktermijn van de klant is verstreken (${shortDate(feedbackDeadline)}). Even persoonlijk navragen.` });
      }
      if (s.videoCount === 0) {
        issues.push({ sessionId: s.id, severity: "warn", message: "Video's staan op 'bij klant', maar in de Frame.io-sessiemap staan geen video's. Controleer de koppeling met Frame.io." });
      }
    } else if (ed === "client_revision") {
      steps.montage = "done";
      steps.feedback = "active";
    } else if (DONE.has(ed)) {
      steps.montage = "done";
      steps.feedback = "done";
      steps.klaar = "done";
    }
  }

  /* Huidige stap = eerste stap die niet af is */
  const order: StepKey[] = ["scripts", "opname", "montage", "feedback", "klaar"];
  const current = order.find((k) => steps[k] !== "done" && steps[k] !== "future")
    ?? order.find((k) => steps[k] !== "done")
    ?? "klaar";
  const state = steps[current];

  const klaarLabel = posting ? "Klaar voor planning" : "Klaar om te plaatsen";
  const labels: Record<StepKey, string> = {
    scripts: "Scripts",
    opname: "Opnamedag",
    montage: "Montage",
    feedback: "Jouw feedback",
    klaar: posting ? "Planning" : "Klaar",
  };

  const videosHref = s.frameSessionKey ? `/portal/videos?sessie=${encodeURIComponent(s.frameSessionKey)}` : "/portal/videos";
  const time = hhmm(s.startTime);
  const shootMeta = [time ? `vanaf ${time} uur` : null, s.locationName].filter(Boolean).join(" · ");

  let statusLabel = "";
  let headline = "";
  let detail = "";
  let action: RoadmapAction | null = null;
  let deadline: string | null = null;
  let priority = 0;

  if (current === "scripts") {
    if (scriptMode === "review") {
      statusLabel = state === "blocked" ? "Reactie op scripts gevraagd" : "Scripts klaar voor controle";
      headline = state === "blocked" ? "We wachten op je reactie op de scripts" : "Je scripts staan klaar!";
      detail = state === "blocked"
        ? "De reactietermijn is voorbij. Geef zo snel mogelijk akkoord of feedback, zodat je opnamedag door kan gaan zoals gepland."
        : "Bekijk ze en geef akkoord, zodat we verder kunnen met de voorbereiding.";
      deadline = scriptDeadline;
      action = { label: "Bekijk scripts", href: `/portal/scripts/${r!.id}` };
      priority = state === "blocked" ? 100 : 85;
    } else if (scriptMode === "offline") {
      statusLabel = "Scripts bij jou ter controle";
      headline = "Je scripts liggen bij jou ter controle";
      detail = "We wachten op je reactie op de scripts die we je hebben gestuurd. Vragen? Je contactpersoon helpt je graag.";
      action = { label: "Neem contact op", href: "/portal/contact" };
      priority = 70;
    } else if (scriptMode === "processing") {
      statusLabel = "We verwerken je feedback";
      headline = "We verwerken je feedback op de scripts";
      detail = "Je ontvangt een nieuwe versie ter controle. Je hoeft nu niets te doen.";
      priority = 45;
    } else {
      statusLabel = scriptMode === "later" ? "Opnamedag gepland" : "Scripts in voorbereiding";
      headline = scriptMode === "later" ? `Je opnamedag staat gepland op ${longDate(s.shootOn)}` : "We bereiden je scripts voor";
      detail = scriptMode === "later"
        ? "We starten tijdig met de scripts. Je hoeft nu niets te doen."
        : `Voor je opnamedag van ${longDate(s.shootOn)}. Zodra ze klaarstaan, vragen we je om akkoord.`;
      priority = scriptMode === "later" ? 15 : 30;
    }
  } else if (current === "opname") {
    if (shootToday) {
      statusLabel = "Vandaag opnamedag";
      headline = "Vandaag is je opnamedag";
      detail = shootMeta ? `${shootMeta}. Fijne opnamedag!` : "Fijne opnamedag!";
      action = { label: "Bekijk opnamedag", href: "/portal/planning" };
      priority = 80;
    } else {
      statusLabel = "Opnamedag gepland";
      headline = `Je volgende opnamedag staat gepland op ${longDate(s.shootOn)}`;
      detail = `${shootMeta ? `${shootMeta}. ` : ""}Bekijk alvast je scripts en de opnamegegevens.`;
      action = { label: "Bekijk opnamedag", href: "/portal/planning" };
      priority = daysToShoot <= 7 ? 60 : 20;
    }
  } else if (current === "montage") {
    statusLabel = delayed ? "Montage duurt iets langer" : "In montage";
    headline = "We zijn je video's aan het monteren";
    detail = delayed
      ? "Het duurt iets langer dan gepland. Je contactpersoon houdt je op de hoogte. Je hoeft nu niets te doen."
      : "Je hoeft op dit moment niets te doen.";
    priority = 40;
  } else if (current === "feedback") {
    if (state === "active") {
      statusLabel = "We verwerken je feedback";
      headline = "We verwerken je feedback";
      detail = "Je hoeft nu niets te doen. Je ontvangt de aangepaste video's zodra ze klaar zijn.";
      priority = 50;
    } else {
      const n = s.videoCount;
      statusLabel = state === "blocked" ? "Feedback gevraagd" : "Klaar voor jouw feedback";
      headline = n > 0 ? `Er ${n === 1 ? "staat" : "staan"} ${n} ${videosWord(n)} klaar voor jouw feedback` : "Je video's staan klaar voor jouw feedback";
      detail = state === "blocked"
        ? "De reactietermijn is voorbij. Geef je feedback zo snel mogelijk, dan ronden we je video's af."
        : `We ontvangen je reactie graag vóór ${longDate(feedbackDeadline!)}.`;
      deadline = feedbackDeadline;
      action = { label: "Bekijk video's", href: videosHref };
      priority = state === "blocked" ? 100 : 90;
    }
  } else {
    statusLabel = posting ? "Goedgekeurd" : "Klaar om te plaatsen";
    headline = "Je video's zijn goedgekeurd";
    detail = posting ? "We zetten ze in je contentplanning en plaatsen ze op de afgesproken kanalen." : "Ze staan klaar om te plaatsen.";
    action = { label: "Bekijk video's", href: videosHref };
    priority = 10;
  }

  // Archief: afgerond en al even niet meer gewijzigd, of te oud/onbekend.
  let archived = false;
  if (steps.klaar === "done" && edit && daysBetween(amsterdamDay(edit.statusChangedAt), today) > ARCHIVE_AFTER_DAYS) archived = true;
  if (stale) archived = true;

  const title = `Opnamedag ${longDate(s.shootOn)}`;
  return {
    id: s.id,
    shootOn: s.shootOn,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    steps: order.map((k) => ({ key: k, label: k === "klaar" ? (steps.klaar === "done" ? klaarLabel : labels.klaar) : labels[k], state: steps[k] })),
    current,
    state,
    statusLabel,
    headline,
    detail,
    deadline,
    expectedOn,
    action,
    priority,
    archived,
  };
}

function toNext(r: SessionRoadmap): NextAction {
  return {
    tone: STATE_TONE[r.state],
    headline: r.headline,
    detail: r.detail,
    deadline: r.deadline,
    expectedOn: r.expectedOn,
    action: r.action,
    sessionId: r.id,
  };
}

/**
 * Volledige roadmap voor één klant. Het prioriteitsmodel kiest precies één
 * hoofdactie, zodat de klant nooit twee tegenstrijdige boodschappen ziet:
 *
 *   100 termijn verstreken (rood)   → 90 video-feedback → 85 scripts akkoord
 *   → 80 opnamedag vandaag → 70 scripts buiten het portaal → 60 opname ≤ 7 dagen
 *   → 50 video-feedback verwerken → 45 scriptfeedback verwerken → 40 montage
 *   → 30 scripts voorbereiden → 20 opname later → 15 scripts later → 10 goedgekeurd
 *
 * Bij gelijke prioriteit wint de vroegste deadline, daarna de vroegste opname.
 */
export function deriveClientRoadmap(sessions: SessionInput[], c: ClientInput): ClientRoadmap {
  const issues: InternalIssue[] = [];
  const inactive = c.clientStatus === "churned" || c.clientStatus === "paused" || c.clientStatus === "prospect";

  if (inactive) {
    const paused = c.clientStatus === "paused";
    return {
      next: {
        tone: "grey",
        headline: paused ? "Je samenwerking staat op pauze" : c.clientStatus === "prospect" ? "Welkom bij Shortclips" : "Je samenwerking is afgerond",
        detail: paused
          ? "Er lopen op dit moment geen producties. Wil je weer starten? Je contactpersoon helpt je graag."
          : c.clientStatus === "prospect"
            ? "Zodra je eerste opnamedag gepland staat, zie je hier precies wat er gebeurt."
            : "Je video's en resultaten blijven hier voor je beschikbaar.",
        deadline: null,
        expectedOn: null,
        action: paused ? { label: "Neem contact op", href: "/portal/contact" } : null,
        sessionId: null,
      },
      alsoForYou: [],
      sessions: [],
      archivedCount: 0,
      publication: null,
      issues,
      inactive: true,
    };
  }

  const all = [...sessions]
    .sort((a, b) => a.shootOn.localeCompare(b.shootOn))
    .map((s) => deriveSession(s, c, issues))
    .filter((r): r is SessionRoadmap => r !== null);
  const visible = all.filter((r) => !r.archived);
  const archivedCount = all.length - visible.length;

  const ranked = [...visible].sort((a, b) =>
    b.priority - a.priority
    || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")
    || a.shootOn.localeCompare(b.shootOn),
  );

  const isClientAction = (r: SessionRoadmap) => r.state === "action" || r.state === "blocked";
  let next: NextAction;
  if (ranked.length === 0) {
    next = {
      tone: "grey",
      headline: "Er staat nog geen nieuwe opnamedag gepland",
      detail: "Zodra er een datum is, zie je die hier. Je hoeft nu niets te doen.",
      deadline: null,
      expectedOn: null,
      action: null,
      sessionId: null,
    };
    issues.push({ sessionId: null, severity: "warn", message: "Actieve klant zonder lopende of geplande opnamesessie." });
  } else {
    next = toNext(ranked[0]!);
  }

  // Alles in orde en geen actie of nabije gebeurtenis → situatie E.
  if (ranked.length > 0 && !isClientAction(ranked[0]!) && ranked[0]!.priority <= 10) {
    next = {
      tone: "green",
      headline: "Alles verloopt volgens planning",
      detail: "Shortclips werkt aan de volgende stap. Zodra jouw actie nodig is, zie je dat hier.",
      deadline: null,
      expectedOn: null,
      action: ranked[0]!.action,
      sessionId: ranked[0]!.id,
    };
  }

  const alsoForYou = ranked
    .slice(1)
    .filter(isClientAction)
    .slice(0, 3)
    .map(toNext);

  // Geen enkele toekomstige sessie terwijl er nog wel loopt → info voor het team.
  if (ranked.length > 0 && !visible.some((r) => r.shootOn >= c.today)) {
    issues.push({ sessionId: null, severity: "info", message: "Er staat geen volgende opnamedag gepland." });
  }

  const publication: PublicationStrip = {
    mode: c.weHandlePosting ? "shortclips" : "self",
    nextPlannedOn: c.nextPlannedOn,
    plannedCount: c.plannedCount,
    lastConfirmedOn: c.lastConfirmedOn,
    confirmedLast30: c.confirmedLast30,
  };

  if (c.weHandlePosting && visible.some((r) => r.current === "klaar" && r.steps.at(-1)?.state === "done") && !c.nextPlannedOn) {
    issues.push({ sessionId: null, severity: "warn", message: "Er zijn goedgekeurde video's, maar er staat geen gedeelde contentplanning klaar voor de klant." });
  }

  return {
    next,
    alsoForYou,
    // Lopende sessies eerst (nieuwste opname bovenaan), afgeronde onderaan.
    sessions: [...visible].sort((a, b) => Number(a.current === "klaar") - Number(b.current === "klaar") || b.shootOn.localeCompare(a.shootOn)),
    archivedCount,
    publication,
    issues,
    inactive: false,
  };
}

/** Werkdagen tot een datum (voor "nog X werkdagen"). */
export function workdaysLeft(today: string, iso: string, holidays?: ReadonlySet<string>): number {
  return workingDaysUntil(today, iso, holidays);
}
