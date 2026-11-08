import { addWorkingDays, workingDaysUntil } from "./workdays";
import { editorDeadline, isFirstVersionPending } from "./edit-deadline";

/**
 * Statuscheck voor editors: halverwege de beschikbare bewerkingstijd vraagt het
 * portaal de editor met één klik hoe ver hij is. Hier staan de pure regels
 * (geen database), zodat ze los te testen zijn. De job en de schermen staan in
 * src/server/editor-status-checks.ts.
 */

export type EditorProgressStatus = "bezig" | "nog_niet" | "bijna_klaar";

export const EDITOR_PROGRESS_OPTIONS: { key: EditorProgressStatus; emoji: string; label: string; team: string }[] = [
  { key: "bezig", emoji: "🟢", label: "Ik ben bezig", team: "Bezig" },
  { key: "nog_niet", emoji: "🟡", label: "Ik moet nog beginnen", team: "Nog niet begonnen" },
  { key: "bijna_klaar", emoji: "✅", label: "Bijna afgerond", team: "Bijna afgerond" },
];

export function isEditorProgressStatus(s: unknown): s is EditorProgressStatus {
  return s === "bezig" || s === "nog_niet" || s === "bijna_klaar";
}

/** Videostatussen waarin het werk bij de editor ligt (en een check zin heeft).
 *  "recorded" en "footage_upload" niet: dan is er nog geen beeldmateriaal. */
const AT_EDITOR = new Set(["awaiting_editor", "editing", "editor_revision", "client_revision"]);

export function isAtEditor(status: string): boolean {
  return AT_EDITOR.has(status);
}

export type EditorCycle = {
  /** first = eerste versie (t/m interne correcties), revision = klantfeedback verwerken. */
  phase: "first" | "revision";
  /** Start van de bewerkingstijd (YYYY-MM-DD). */
  start: string;
  /** De editor deadline (YYYY-MM-DD). Nooit de opleverdeadline aan de klant. */
  deadline: string;
  /** Unieke sleutel van deze cyclus: verschuift de deadline, dan is het een nieuwe cyclus. */
  cycleKey: string;
  /** Totaal aantal werkdagen bewerkingstijd (minimaal 1). */
  totalWorkdays: number;
  /** De dag waarop 50% van de bewerkingstijd verstreken is. */
  halfwayOn: string;
};

/**
 * De bewerkingscyclus van een video vanuit de editor gezien. Gebruikt dezelfde
 * editor deadline als het editorportaal en de agendafeed (lib/edit-deadline).
 *
 *  - Eerste versie: start = opnamedatum (centrale opnameplanning wint).
 *  - Klantfeedback verwerken: start = de dag dat de feedback bij de editor kwam.
 *
 * Geen editor deadline of geen startpunt → null (dan sturen we niets).
 */
export function editorCycle(
  input: {
    status: string;
    shootOn: string | null | undefined;
    dueOn: string | null | undefined;
    /** Dag waarop de video zijn huidige status kreeg (YYYY-MM-DD, Amsterdam). */
    statusSince: string;
  },
  holidays?: ReadonlySet<string>,
): EditorCycle | null {
  if (!isAtEditor(input.status)) return null;
  const deadline = editorDeadline(input.status, input.shootOn, input.dueOn, holidays);
  if (!deadline) return null;
  const phase = isFirstVersionPending(input.status) ? "first" : "revision";
  let start: string | null = phase === "first" ? (input.shootOn ?? null) : input.statusSince;
  // Zonder opnamedatum: de editor deadline is dan uit de klantdeadline afgeleid;
  // reken vanaf de dag dat het werk bij de editor kwam.
  if (!start) start = input.statusSince;
  if (start > deadline) start = deadline;
  const totalWorkdays = Math.max(1, workingDaysUntil(start, deadline, holidays));
  // 50% verstreken: 8 werkdagen → dag 4, 7 werkdagen → dag 4.
  const halfwayOn = addWorkingDays(start, Math.max(1, Math.ceil(totalWorkdays / 2)), holidays);
  return { phase, start, deadline, cycleKey: `${phase}:${deadline}`, totalWorkdays, halfwayOn: halfwayOn > deadline ? deadline : halfwayOn };
}

/** Een editor die binnen deze periode al een status gaf, krijgt geen nieuwe check. */
export const RECENT_STATUS_WORKDAYS = 2;
/** Na zoveel werkdagen zonder reactie wordt het een aandachtspunt voor het team. */
export const NO_REPLY_WORKDAYS = 1;
/** Nog niet begonnen terwijl er nog maar zoveel werkdagen zijn = risico. */
export const RISK_WORKDAYS_LEFT = 3;

export type CheckPlan = { kind: "halfway" | "pre_deadline" } | null;

/**
 * Moet er nu een check uit voor deze video? Eén plek met alle regels tegen
 * irritatie:
 *  - halverwege: vanaf de 50%-dag tot en met de deadline, één keer per cyclus;
 *  - kort voor de deadline (1 werkdag ervoor): alleen bij risico, dus als de
 *    editor nog niet begonnen is of nooit reageerde;
 *  - nooit als er al een onbeantwoorde check openstaat;
 *  - nooit als de editor recent (2 werkdagen) zelf al een status gaf.
 */
export function planCheck(
  cycle: EditorCycle,
  today: string,
  state: {
    /** Bestaan er al checks in deze cyclus? */
    hasHalfwayThisCycle: boolean;
    hasPreDeadlineThisCycle: boolean;
    /** Staat er voor deze video nog een onbeantwoorde check open (welke cyclus ook)? */
    hasOpenCheck: boolean;
    /** Laatste antwoord op deze video (welke cyclus ook). */
    lastResponse: { status: EditorProgressStatus; on: string } | null;
    /** Laatste antwoord binnen deze cyclus. */
    lastResponseThisCycle: EditorProgressStatus | null;
    /** Is er in deze cyclus een check die nooit beantwoord werd? */
    unansweredThisCycle: boolean;
  },
  holidays?: ReadonlySet<string>,
): CheckPlan {
  if (today > cycle.deadline) return null; // te laat: dat loopt via de bestaande deadlinesignalen

  // Kort voor de deadline, alleen bij risico: nog niet begonnen of nooit gereageerd.
  // Vervangt een eventueel onbeantwoorde check (het antwoord geldt voor beide).
  const left = workingDaysUntil(today, cycle.deadline, holidays);
  if (!state.hasPreDeadlineThisCycle && state.hasHalfwayThisCycle && left <= 1 && cycle.totalWorkdays >= 3) {
    const atRisk =
      state.lastResponseThisCycle === "nog_niet" ||
      (state.lastResponseThisCycle === null && state.unansweredThisCycle);
    if (atRisk) return { kind: "pre_deadline" };
  }

  if (state.hasHalfwayThisCycle || state.hasOpenCheck || today < cycle.halfwayOn) return null;
  const recent = state.lastResponse
    ? workingDaysUntil(state.lastResponse.on, today, holidays) < RECENT_STATUS_WORKDAYS
    : false;
  return recent ? null : { kind: "halfway" };
}

export type ProgressView = {
  key: "geen" | "verstuurd" | "geen_reactie" | "bezig" | "nog_niet" | "risico" | "bijna_klaar";
  label: string;
  tone: "muted" | "info" | "warn" | "bad" | "good";
};

/**
 * Wat Team Shortclips ziet in de kolom Voortgang. Kleur volgt de huisregels:
 * groen = goed, oranje = aandacht, rood = risico.
 */
export function progressView(
  latest: { status: EditorProgressStatus | null; sentAt: Date; respondedAt: Date | null } | null,
  now: Date,
  editorDueOn: string | null,
  holidays?: ReadonlySet<string>,
): ProgressView {
  if (!latest) return { key: "geen", label: "Nog geen check", tone: "muted" };
  const today = amsterdamDate(now);
  if (!latest.status) {
    return noReplyOverdue(latest.sentAt, now, holidays)
      ? { key: "geen_reactie", label: "Geen reactie", tone: "warn" }
      : { key: "verstuurd", label: "Check verstuurd", tone: "info" };
  }
  if (latest.status === "nog_niet") {
    const left = editorDueOn ? workingDaysUntil(today, editorDueOn, holidays) : null;
    if (left !== null && left <= RISK_WORKDAYS_LEFT) return { key: "risico", label: "Nog niet begonnen", tone: "bad" };
    return { key: "nog_niet", label: "Nog niet begonnen", tone: "warn" };
  }
  if (latest.status === "bijna_klaar") return { key: "bijna_klaar", label: "Bijna afgerond", tone: "good" };
  return { key: "bezig", label: "Bezig", tone: "good" };
}

/** Eén werkdag zonder reactie: vanaf dezelfde kloktijd op de volgende werkdag. */
export function noReplyOverdue(sentAt: Date, now: Date, holidays?: ReadonlySet<string>): boolean {
  const sentDay = amsterdamDate(sentAt);
  const today = amsterdamDate(now);
  const wd = workingDaysUntil(sentDay, today, holidays);
  if (wd > NO_REPLY_WORKDAYS) return true;
  if (wd < NO_REPLY_WORKDAYS) return false;
  return amsterdamMinutes(now) >= amsterdamMinutes(sentAt);
}

/** Alleen tijdens werktijd versturen: ma t/m vr, geen feestdag, 09:00 tot 17:00 (Amsterdam). */
export function isWorkingHours(now: Date, holidays?: ReadonlySet<string>): boolean {
  const day = now.toLocaleDateString("en-US", { weekday: "short", timeZone: "Europe/Amsterdam" });
  if (day === "Sat" || day === "Sun") return false;
  if (holidays?.has(amsterdamDate(now))) return false;
  const m = amsterdamMinutes(now);
  return m >= 9 * 60 && m < 17 * 60;
}

export function amsterdamDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

function amsterdamMinutes(d: Date): number {
  const hhmm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Amsterdam" });
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "zojuist", "2 uur geleden", "gisteren", "3 dagen geleden". */
export function updatedAgo(at: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  if (min < 2) return "zojuist";
  if (min < 60) return `${min} min geleden`;
  const h = Math.round(min / 60);
  if (h < 24 && amsterdamDate(at) === amsterdamDate(now)) return `${h} uur geleden`;
  const days = Math.round((Date.parse(amsterdamDate(now)) - Date.parse(amsterdamDate(at))) / 86_400_000);
  if (days <= 1) return "gisteren";
  return `${days} dagen geleden`;
}
