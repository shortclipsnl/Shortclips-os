/**
 * Werkdagen-rekenhulp (ma–vr). Feestdagen worden niet meegerekend; de
 * productieafspraken van Shortclips rekenen in werkdagen na de opname.
 */

function parse(dateStr: string): Date {
  return new Date(dateStr.slice(0, 10) + "T00:00:00Z");
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** n werkdagen ná een datum (bijv. opnamedatum + 14 werkdagen = klantdeadline). */
export function addWorkingDays(dateStr: string, n: number): string {
  const d = parse(dateStr);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) added++;
  }
  return fmt(d);
}

/** n werkdagen vóór een datum (bijv. klantdeadline − 14 werkdagen ≈ opname). */
export function subWorkingDays(dateStr: string, n: number): string {
  const d = parse(dateStr);
  let removed = 0;
  while (removed < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isWeekend(d)) removed++;
  }
  return fmt(d);
}

/** Aantal kalenderdagen tussen twee YYYY-MM-DD datums (absoluut). */
export function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000));
}

/** Aantal werkdagen (ma–vr) in een periode, inclusief begin- en einddatum. */
export function workingDaysBetween(start: string, end: string): number {
  let a = parse(start);
  const b = parse(end);
  if (b < a) return 0;
  let count = 0;
  while (a <= b) {
    if (!isWeekend(a)) count++;
    a = new Date(a.getTime() + 86_400_000);
  }
  return count;
}
