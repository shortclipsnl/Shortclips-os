/**
 * Nederlandse feestdagen ("ingestelde feestdagen") voor de werkdagenberekening.
 * Berekend per jaar; Pasen via het algoritme van Butcher. Deze dagen tellen niet
 * mee als werkdag in de deadlinetimer.
 *
 * Opgenomen: Nieuwjaarsdag, Goede Vrijdag, 1e/2e Paasdag, Koningsdag,
 * Bevrijdingsdag, Hemelvaartsdag, 1e/2e Pinksterdag, 1e/2e Kerstdag.
 */

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Eerste paasdag (zondag) voor een jaar — algoritme van Butcher. */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** Alle Nederlandse feestdagen in één jaar (als YYYY-MM-DD). */
export function nlHolidaysForYear(year: number): string[] {
  const easter = easterSunday(year);
  // Koningsdag: 27 april, maar op zondag naar 26 april.
  const apr27 = new Date(iso(year, 4, 27) + "T00:00:00Z");
  const koningsdag = apr27.getUTCDay() === 0 ? iso(year, 4, 26) : iso(year, 4, 27);
  return [
    iso(year, 1, 1), // Nieuwjaarsdag
    addDays(easter, -2), // Goede Vrijdag
    easter, // 1e Paasdag
    addDays(easter, 1), // 2e Paasdag
    koningsdag,
    iso(year, 5, 5), // Bevrijdingsdag
    addDays(easter, 39), // Hemelvaartsdag
    addDays(easter, 49), // 1e Pinksterdag
    addDays(easter, 50), // 2e Pinksterdag
    iso(year, 12, 25), // 1e Kerstdag
    iso(year, 12, 26), // 2e Kerstdag
  ];
}

/** Feestdagen-set over een reeks jaren, standaard huidig jaar ± 1. */
export function nlHolidaySet(years?: number[]): Set<string> {
  const yrs = years ?? (() => { const y = new Date().getFullYear(); return [y - 1, y, y + 1]; })();
  const set = new Set<string>();
  for (const y of yrs) for (const h of nlHolidaysForYear(y)) set.add(h);
  return set;
}
