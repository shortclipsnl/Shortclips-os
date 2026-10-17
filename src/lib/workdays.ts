/**
 * Werkdagen-rekenhulp (ma–vr). Optioneel kunnen feestdagen worden meegegeven
 * (zie lib/holidays.ts) die dan ook niet als werkdag tellen. Zonder die set is
 * het gedrag ongewijzigd (alleen weekenden). De productieafspraken van
 * Shortclips rekenen in werkdagen na de opname.
 */

type Holidays = ReadonlySet<string> | undefined;

function parse(dateStr: string): Date {
  return new Date(dateStr.slice(0, 10) + "T00:00:00Z");
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function isNonWorking(d: Date, holidays: Holidays): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return true;
  return holidays ? holidays.has(fmt(d)) : false;
}

/** n werkdagen ná een datum (bijv. opnamedatum + 14 werkdagen = klantdeadline). */
export function addWorkingDays(dateStr: string, n: number, holidays?: Holidays): string {
  const d = parse(dateStr);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isNonWorking(d, holidays)) added++;
  }
  return fmt(d);
}

/** n werkdagen vóór een datum (bijv. klantdeadline − 14 werkdagen ≈ opname). */
export function subWorkingDays(dateStr: string, n: number, holidays?: Holidays): string {
  const d = parse(dateStr);
  let removed = 0;
  while (removed < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isNonWorking(d, holidays)) removed++;
  }
  return fmt(d);
}

/** Aantal kalenderdagen tussen twee YYYY-MM-DD datums (absoluut). */
export function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000));
}

/** Aantal werkdagen (ma–vr) in een periode, inclusief begin- en einddatum. */
export function workingDaysBetween(start: string, end: string, holidays?: Holidays): number {
  let a = parse(start);
  const b = parse(end);
  if (b < a) return 0;
  let count = 0;
  while (a <= b) {
    if (!isNonWorking(a, holidays)) count++;
    a = new Date(a.getTime() + 86_400_000);
  }
  return count;
}

/**
 * Werkdagen tussen vandaag en een deadline, mét teken: positief = nog te gaan
 * (deadline in de toekomst), 0 = vandaag, negatief = deadline verstreken.
 */
export function workingDaysUntil(from: string, deadline: string, holidays?: Holidays): number {
  if (deadline === from) return 0;
  return deadline > from
    ? workingDaysBetween(from, deadline, holidays) - 1
    : -(workingDaysBetween(deadline, from, holidays) - 1);
}
