import { addWorkingDays, workingDaysUntil } from "./workdays";

/**
 * Feedbacktermijn van de klant: altijd in WERKDAGEN, nooit in uren.
 * Sturen we iets op vrijdag, dan telt het weekend niet mee: bij 3 werkdagen
 * loopt de termijn tot en met woensdag. De termijn zelf komt uit de
 * portaalinstellingen (Instellingen > Klantportaal, eventueel per klant
 * afwijkend), zodat het team en de klant met hetzelfde getal werken.
 */

/** Kalenderdatum in Amsterdam (YYYY-MM-DD) van een tijdstip. */
export function amsterdamDay(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

/** Laatste dag waarop de klant nog binnen de termijn reageert. */
export function clientFeedbackDue(sentAt: Date | string, workdays: number, holidays?: ReadonlySet<string>): string {
  return addWorkingDays(amsterdamDay(sentAt), Math.max(1, Math.round(workdays)), holidays);
}

/** Termijn verstreken? Pas de dag ná de laatste feedbackdag. */
export function isClientFeedbackOverdue(
  sentAt: Date | string,
  workdays: number,
  today: string,
  holidays?: ReadonlySet<string>,
): boolean {
  return today > clientFeedbackDue(sentAt, workdays, holidays);
}

/** Aantal werkdagen dat iets al bij de klant ligt. */
export function workdaysAtClient(sentAt: Date | string, today: string, holidays?: ReadonlySet<string>): number {
  return Math.max(0, workingDaysUntil(amsterdamDay(sentAt), today, holidays));
}
