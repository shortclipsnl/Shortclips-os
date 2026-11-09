import { amsterdamDay, clientFeedbackDue } from "./client-feedback";
import { workingDaysUntil } from "./workdays";

/**
 * Feedbacktermijn van de klant per feedbackronde, in werkdagen.
 *
 * De ronde start op de dag dat de klant de video's ontving (dag 0). Daarna telt
 * elke werkdag één dag: bij een termijn van 3 werkdagen is dag 3 de laatste dag
 * binnen de termijn (gelijk aan `clientFeedbackDue`). Weekenden en Nederlandse
 * feestdagen tellen niet mee. Op de laatste dag krijgt de vaste verantwoordelijke
 * van de klant om 09:00 een herinnering; de dag erna is de klant te laat.
 */

export type FeedbackStage = "gestart" | "loopt" | "laatste_dag_morgen" | "herinnering" | "te_laat";

export type FeedbackTermState = {
  /** Werkdagen sinds de klant de video's ontving (0 = op de dag zelf). */
  day: number;
  termDays: number;
  /** Werkdagen die de klant nog heeft ná vandaag (0 = vandaag is de laatste dag). */
  remaining: number;
  /** Werkdagen te laat (0 = nog binnen de termijn). */
  lateBy: number;
  dueOn: string;
  stage: FeedbackStage;
};

export function feedbackTermState(
  startedAt: Date | string,
  termDays: number,
  today: string,
  holidays?: ReadonlySet<string>,
): FeedbackTermState {
  const term = Math.max(1, Math.round(termDays));
  const startedOn = amsterdamDay(startedAt);
  const dueOn = clientFeedbackDue(startedAt, term, holidays);
  const day = Math.max(0, workingDaysUntil(startedOn, today, holidays));
  const remaining = Math.max(0, term - day);
  const lateBy = Math.max(0, day - term);
  let stage: FeedbackStage;
  if (lateBy > 0) stage = "te_laat";
  else if (day === term) stage = "herinnering";
  else if (day === 0) stage = "gestart";
  else if (remaining === 1) stage = "laatste_dag_morgen";
  else stage = "loopt";
  return { day, termDays: term, remaining, lateBy, dueOn, stage };
}

/** Korte, scanbare tekst voor het label op de Editing-pagina. */
export function feedbackTermLabel(s: FeedbackTermState): { title: string; sub: string; tone: "groen" | "oranje" | "rood" | "rood_vol" } {
  const wd = (n: number) => `${n} werkdag${n === 1 ? "" : "en"}`;
  switch (s.stage) {
    case "gestart":
      return { title: "Termijn gestart", sub: `Nog ${wd(s.termDays)}`, tone: "groen" };
    case "loopt":
      return { title: `Dag ${s.day} van ${s.termDays}`, sub: `Nog ${wd(s.remaining)}`, tone: "groen" };
    case "laatste_dag_morgen":
      return { title: `Dag ${s.day} van ${s.termDays}`, sub: `Nog ${wd(s.remaining)}`, tone: "oranje" };
    case "herinnering":
      return { title: `Dag ${s.day} van ${s.termDays}`, sub: "Herinnering sturen", tone: "rood" };
    case "te_laat":
      return { title: "Klant te laat", sub: `${wd(s.lateBy)} over de termijn`, tone: "rood_vol" };
  }
}

/** Tijdstip (Amsterdam) waarop de interne herinnering op werkdag 3 mag verschijnen. */
export const REMINDER_HOUR = 9;

/** Uur van de dag in Amsterdam (0-23). */
export function amsterdamHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hour12: false }).format(now)) % 24;
}

/**
 * Moet er nu een herinnering komen voor deze ronde? Alleen op een werkdag, vanaf
 * 09:00, wanneer de laatste termijndag bereikt is, en nooit twee keer.
 */
export function reminderDue(input: {
  state: FeedbackTermState;
  now: Date;
  today: string;
  alreadyReminded: boolean;
  holidays?: ReadonlySet<string>;
}): boolean {
  if (input.alreadyReminded) return false;
  if (input.state.day < input.state.termDays) return false;
  if (!isWorkday(input.today, input.holidays)) return false;
  return amsterdamHour(input.now) >= REMINDER_HOUR;
}

export function isWorkday(day: string, holidays?: ReadonlySet<string>): boolean {
  const d = new Date(day + "T00:00:00Z").getUTCDay();
  if (d === 0 || d === 6) return false;
  return !(holidays?.has(day) ?? false);
}

/**
 * Wat moet er met de rondes van één video gebeuren? Puur beslismodel (los
 * getest); de database-uitvoering staat in server/feedback-rounds.ts.
 */
export type RoundVideo = { status: string; deleted: boolean; statusChangedAt: Date | string; clientRevisionRounds: number };
export type OpenRound = { id: string; revisionMark: number } | null;

export function planRound(video: RoundVideo | null, open: OpenRound): { close: boolean; open: boolean } {
  const atClient = !!video && !video.deleted && video.status === "client_review";
  if (!open) return { close: false, open: atClient };
  if (!atClient) return { close: true, open: false };
  // Tussendoor feedback gegeven en opnieuw naar de klant: nieuwe ronde.
  if (video.clientRevisionRounds > open.revisionMark) return { close: true, open: true };
  return { close: false, open: false };
}
