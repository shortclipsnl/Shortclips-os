/** Tijdhulpen voor de coach. Alles in Europe/Amsterdam. */
const TZ = "Europe/Amsterdam";

export function amsDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function amsHour(d = new Date()): number {
  return Number(d.toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ }).slice(0, 2));
}

export function amsWeekday(d = new Date()): string {
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
}

/** Datum (JJJJ-MM-DD) plus n dagen. */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO-weeknummer als "JJJJ-wNN" voor een datum (JJJJ-MM-DD). */
export function isoWeekId(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-w${String(week).padStart(2, "0")}`;
}

/** Maandag (JJJJ-MM-DD) van de week waarin de datum valt. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  return addDaysIso(iso, -day);
}

/** Offset (ms) van Amsterdam t.o.v. UTC op een bepaald moment. */
function offsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** UTC-moment van 00:00 Amsterdam op een datum (JJJJ-MM-DD). */
export function amsStartOfDay(iso: string): Date {
  const middag = new Date(`${iso}T12:00:00Z`);
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() - offsetMs(middag));
}

export function longDateNl(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}
