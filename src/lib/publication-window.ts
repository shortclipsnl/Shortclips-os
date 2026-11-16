/**
 * Dagelijks publicatiemoment van Shortclips: op werkdagen van 14:00 tot 17:00
 * (Nederlandse tijd). In dat venster klapt de publicatiecheck op de
 * Contentplanning automatisch open voor Jarno, Milou en Jiska.
 *
 * Bewust een pure functie zonder server-only, zodat dezelfde regel op de
 * server (eerste weergave) en in de browser (pagina die al openstaat) geldt.
 */
export const PUBLICATION_WINDOW = { startMinutes: 14 * 60, endMinutes: 17 * 60 } as const;

const WORKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** Datum (yyyy-mm-dd), weekdag en minuten van de dag in Europe/Amsterdam. */
export function amsterdamClock(now: Date = new Date()): { date: string; weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24; // sommige runtimes geven "24" om middernacht
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    minutes: hour * 60 + Number(get("minute")),
  };
}

/** Valt dit moment binnen het publicatiemoment (werkdag, 14:00 tot 17:00 NL-tijd)? */
export function isInPublicationWindow(now: Date = new Date()): boolean {
  const c = amsterdamClock(now);
  return (
    WORKDAYS.includes(c.weekday) &&
    c.minutes >= PUBLICATION_WINDOW.startMinutes &&
    c.minutes < PUBLICATION_WINDOW.endMinutes
  );
}

/**
 * Sleutel van de huidige "fase" (bv. 2026-11-16:open of 2026-11-16:dicht).
 * Een handmatige keuze van de gebruiker geldt tot de fase wisselt; bij een
 * nieuwe fase volgt het onderdeel weer de automatische stand.
 */
export function publicationPhaseKey(now: Date = new Date()): string {
  const c = amsterdamClock(now);
  return `${c.date}:${isInPublicationWindow(now) ? "open" : "dicht"}`;
}
