import { amsterdamDay, clientFeedbackDue } from "./client-feedback";
import { workingDaysUntil } from "./workdays";

/**
 * Eén rekenregel voor elke feedbackdeadline richting de klant.
 *
 * - Termijn in WERKDAGEN (weekenden en Nederlandse feestdagen tellen niet mee).
 * - De deadline loopt tot het einde van de werkdag: 17:00 Nederlandse tijd.
 * - De dag van versturen is dag 0.
 *
 * Scripts, video's, correctieversies en scriptmeetings gebruiken allemaal deze
 * functies, zodat team, klant en WhatsApp-bericht dezelfde datum en tijd tonen.
 */

export const DEADLINE_HOUR = 17;
export const DEADLINE_TIME_LABEL = "17:00";

/** UTC-tijdstip van een kloktijd in Amsterdam op een kalenderdag (zomer- en wintertijd). */
export function amsterdamTimeOn(day: string, hour = DEADLINE_HOUR): Date {
  const guess = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  const shown = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hour12: false }).format(guess),
  ) % 24;
  return new Date(guess.getTime() - (shown - hour) * 3_600_000);
}

/** Laatste dag binnen de termijn (YYYY-MM-DD, Amsterdam). */
export function feedbackDueDay(sentAt: Date | string, workdays: number, holidays?: ReadonlySet<string>): string {
  return clientFeedbackDue(sentAt, workdays, holidays);
}

/** Het exacte deadlinemoment: de laatste termijndag om 17:00 Nederlandse tijd. */
export function feedbackDeadlineAt(sentAt: Date | string, workdays: number, holidays?: ReadonlySet<string>): Date {
  return amsterdamTimeOn(feedbackDueDay(sentAt, workdays, holidays));
}

const LONG = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long" });
const SHORT = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short" });

/** "donderdag 19 november" voor een dag (YYYY-MM-DD) of tijdstip. */
export function deadlineDayLabel(d: Date | string): string {
  return LONG.format(typeof d === "string" && d.length === 10 ? new Date(`${d}T12:00:00Z`) : new Date(d));
}

/** "donderdag 19 november om 17:00" — de vorm voor berichten en het klantportaal. */
export function deadlineLabel(d: Date | string): string {
  return `${deadlineDayLabel(d)} om ${DEADLINE_TIME_LABEL}`;
}

/** "do 19 nov 17:00" — compact, voor interne tabellen. */
export function deadlineShortLabel(d: Date | string): string {
  const day = SHORT.format(typeof d === "string" && d.length === 10 ? new Date(`${d}T12:00:00Z`) : new Date(d)).replace(/\./g, "");
  return `${day} ${DEADLINE_TIME_LABEL}`;
}

export function workdaysLabel(n: number): string {
  return `${n} werkdag${n === 1 ? "" : "en"}`;
}

/** Werkdagen tot en met de deadline-dag (0 = vandaag is de laatste dag, negatief = te laat). */
export function workdaysLeft(dueDay: string, today: string, holidays?: ReadonlySet<string>): number {
  if (today > dueDay) return -workingDaysUntil(dueDay, today, holidays);
  return workingDaysUntil(today, dueDay, holidays);
}

/** "nog 2 werkdagen" · "vandaag vóór 17:00" · "1 werkdag te laat". */
export function timeLeftLabel(dueDay: string, today: string, holidays?: ReadonlySet<string>): string {
  const left = workdaysLeft(dueDay, today, holidays);
  if (left < 0) return `${workdaysLabel(-left)} te laat`;
  if (left === 0) return `vandaag vóór ${DEADLINE_TIME_LABEL}`;
  return `nog ${workdaysLabel(left)}`;
}

/* ------------------------------------------------------------------ *
 * Feedbackstatus voor het interne overzicht (klantenpagina)
 * ------------------------------------------------------------------ */

export type FeedbackStatusKey = "verlopen" | "nadert" | "wacht" | "ontvangen" | "afgerond";

export const FEEDBACK_STATUS: Record<FeedbackStatusKey, { label: string; tone: "red" | "orange" | "blue" | "green"; order: number }> = {
  verlopen: { label: "Deadline verlopen", tone: "red", order: 0 },
  nadert: { label: "Deadline nadert", tone: "orange", order: 1 },
  ontvangen: { label: "Feedback ontvangen", tone: "green", order: 2 },
  wacht: { label: "Wacht op feedback", tone: "blue", order: 3 },
  afgerond: { label: "Afgerond", tone: "green", order: 4 },
};

/**
 * Status van één openstaande ronde bij de klant. "Nadert" = de laatste werkdag
 * of de werkdag ervoor. "Verlopen" pas de dag ná de deadline-dag.
 */
export function waitingStatus(dueDay: string, today: string, holidays?: ReadonlySet<string>): "verlopen" | "nadert" | "wacht" {
  const left = workdaysLeft(dueDay, today, holidays);
  if (left < 0) return "verlopen";
  if (left <= 1) return "nadert";
  return "wacht";
}

export { amsterdamDay };
