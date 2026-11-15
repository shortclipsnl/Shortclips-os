/**
 * Periodekeuze voor de resultatenpagina (klantportaal én intern portaal).
 * Eén bron zodat beide portalen exact dezelfde perioden en vergelijking gebruiken.
 *
 * Hoofdkeuze: Maandelijks (kalendermaand, sleutel "2026-10") of Per kwartaal
 * (sleutel "2026-Q3"). Daarnaast blijven de doorlopende perioden (30 dagen, 3, 6
 * en 12 maanden) en een eigen periode bestaan.
 *
 * Vergelijking: een maand met de maand ervoor, een kwartaal met het kwartaal
 * ervoor. Is de gekozen periode nog bezig, dan vergelijken we met hetzelfde
 * aantal dagen aan het begin van de vorige periode. Zo wordt een halve maand
 * nooit tegen een hele maand afgezet.
 */

export const PORTAL_PERIODS = [
  { key: "30", days: 30, label: "30 dagen" },
  { key: "90", days: 90, label: "3 maanden" },
  { key: "180", days: 180, label: "6 maanden" },
  { key: "365", days: 365, label: "12 maanden" },
] as const;

/** Oude sleutels; blijven werken zodat bestaande links niet breken. */
export const PORTAL_MONTH_PERIODS = [
  { key: "maand", label: "Deze maand" },
  { key: "vorigemaand", label: "Vorige maand" },
] as const;

export type PeriodMode = "maand" | "kwartaal" | "vrij";

export type PortalPeriod = {
  days: number;
  from?: string;
  to?: string;
  key: string;
  mode: PeriodMode;
  /** "oktober 2026", "Q3 2026", "Afgelopen 30 dagen" of de datums van een eigen periode. */
  label: string;
  /** Alleen bij maand en kwartaal: de periode waarmee we vergelijken. */
  prevFrom?: string;
  prevTo?: string;
  prevLabel?: string;
  /** False zolang de gekozen maand of het gekozen kwartaal nog loopt. */
  complete: boolean;
};

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER_KEY = /^(\d{4})-Q([1-4])$/;
const DAY = 86_400_000;

export function amsToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY) + 1;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const nlDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export const monthKeyOf = (iso: string) => iso.slice(0, 7);
export function quarterKeyOf(iso: string): string {
  const m = Number(iso.slice(5, 7));
  return `${iso.slice(0, 4)}-Q${Math.ceil(m / 3)}`;
}

/** "2026-10" → "oktober 2026". */
export function monthLabel(key: string): string {
  const m = MONTH_KEY.exec(key);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : key;
}
/** "2026-Q3" → "Q3 2026". */
export function quarterLabel(key: string): string {
  const m = QUARTER_KEY.exec(key);
  return m ? `Q${m[2]} ${m[1]}` : key;
}

export function monthKeyRange(key: string): { from: string; to: string } | null {
  const m = MONTH_KEY.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return { from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` };
}

export function quarterKeyRange(key: string): { from: string; to: string } | null {
  const m = QUARTER_KEY.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const first = (Number(m[2]) - 1) * 3 + 1;
  return { from: `${y}-${pad(first)}-01`, to: `${y}-${pad(first + 2)}-${pad(lastDay(y, first + 2))}` };
}

export function shiftMonthKey(key: string, delta: number): string {
  const m = MONTH_KEY.exec(key)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function shiftQuarterKey(key: string, delta: number): string {
  const m = QUARTER_KEY.exec(key)!;
  const idx = Number(m[1]) * 4 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`;
}

/** De drie maandsleutels van een kwartaal, oudste eerst. */
export function monthsOfQuarter(key: string): string[] {
  const r = quarterKeyRange(key);
  if (!r) return [];
  const first = monthKeyOf(r.from);
  return [first, shiftMonthKey(first, 1), shiftMonthKey(first, 2)];
}

/** Van/tot voor de oude maandsleutels (YYYY-MM-DD), of null als het geen maandkeuze is. */
export function monthRange(key: string, today = amsToday()): { from: string; to: string } | null {
  if (key === "maand") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (key === "vorigemaand") return monthKeyRange(shiftMonthKey(monthKeyOf(today), -1));
  return null;
}

function calendarPeriod(key: string, mode: "maand" | "kwartaal", today: string): PortalPeriod | null {
  const full = mode === "maand" ? monthKeyRange(key) : quarterKeyRange(key);
  if (!full || full.from > today) return null;
  const complete = full.to < today;
  const to = complete ? full.to : today;
  const days = daysBetween(full.from, to);
  const prevKey = mode === "maand" ? shiftMonthKey(key, -1) : shiftQuarterKey(key, -1);
  const prevFull = (mode === "maand" ? monthKeyRange(prevKey) : quarterKeyRange(prevKey))!;
  // Lopende periode: vergelijk met hetzelfde aantal dagen van de vorige periode.
  const prevToRaw = complete ? prevFull.to : addDays(prevFull.from, days - 1);
  const prevTo = prevToRaw > prevFull.to ? prevFull.to : prevToRaw;
  return {
    days,
    from: full.from,
    to,
    key,
    mode,
    label: mode === "maand" ? monthLabel(key) : quarterLabel(key),
    prevFrom: prevFull.from,
    prevTo,
    prevLabel: mode === "maand" ? monthLabel(prevKey) : quarterLabel(prevKey),
    complete,
  };
}

/**
 * Leest ?periode= (+ ?van=&tot= voor een eigen periode) uit de query.
 * Zonder keuze: de lopende maand.
 */
export function parsePortalPeriod(sp: { periode?: string; van?: string; tot?: string }, today = amsToday()): PortalPeriod {
  const { periode, van, tot } = sp;
  if (periode === "custom" && van && tot && ISO.test(van) && ISO.test(tot) && van <= tot) {
    return { days: Math.max(1, daysBetween(van, tot)), from: van, to: tot, key: "custom", mode: "vrij", label: `${nlDate(van)} t/m ${nlDate(tot)}`, complete: tot < today };
  }
  const rolling = PORTAL_PERIODS.find((p) => p.key === periode);
  if (rolling) return { days: rolling.days, key: rolling.key, mode: "vrij", label: `Afgelopen ${rolling.label}`, complete: false };

  const thisMonth = monthKeyOf(today);
  if (periode && QUARTER_KEY.test(periode)) {
    const q = calendarPeriod(periode, "kwartaal", today);
    if (q) return q;
  }
  if (periode === "kwartaal") return calendarPeriod(quarterKeyOf(today), "kwartaal", today)!;
  const key = periode === "vorigemaand" ? shiftMonthKey(thisMonth, -1) : periode && MONTH_KEY.test(periode) ? periode : thisMonth;
  return calendarPeriod(key, "maand", today) ?? calendarPeriod(thisMonth, "maand", today)!;
}

/** Bouwt de query-string voor een periode (voor links). */
export function portalPeriodQuery(p: { key: string; from?: string; to?: string }): string {
  if (p.key === "custom" && p.from && p.to) return `periode=custom&van=${p.from}&tot=${p.to}`;
  return `periode=${p.key}`;
}

/** De opties voor de serveraanroep (cijfers + vergelijking). */
export function periodResultOpts(p: PortalPeriod): { days: number; from?: string; to?: string; periodKey: string; prevFrom?: string; prevTo?: string } {
  return { days: p.days, from: p.from, to: p.to, periodKey: p.key, prevFrom: p.prevFrom, prevTo: p.prevTo };
}

export type PeriodOption = { key: string; label: string };

/**
 * Alle maanden en kwartalen die de klant kan terugkijken: vanaf de eerste maand
 * met cijfers tot en met nu, nieuwste eerst.
 */
export function periodOptions(firstDataOn: string | null, today = amsToday()): { months: PeriodOption[]; quarters: PeriodOption[] } {
  const current = monthKeyOf(today);
  let first = firstDataOn && ISO.test(firstDataOn) && firstDataOn <= today ? monthKeyOf(firstDataOn) : current;
  // Nooit meer dan vijf jaar terug: houdt de keuzelijst bruikbaar.
  const floor = shiftMonthKey(current, -59);
  if (first < floor) first = floor;
  const months: PeriodOption[] = [];
  for (let k = current; k >= first; k = shiftMonthKey(k, -1)) months.push({ key: k, label: monthLabel(k) });
  const quarters: PeriodOption[] = [];
  const firstQ = quarterKeyOf(`${first}-01`);
  for (let k = quarterKeyOf(today); k >= firstQ; k = shiftQuarterKey(k, -1)) quarters.push({ key: k, label: quarterLabel(k) });
  return { months, quarters };
}

/**
 * Beschrijving van een periode op basis van wat de resultaten teruggeven
 * (sleutel + begin- en einddatum). Voor weergaven die alleen de resultaten hebben.
 */
export function describePeriod(key: string, start: string, end: string, today = amsToday()): PortalPeriod {
  return parsePortalPeriod({ periode: key, van: start, tot: end }, today);
}

/** Eerste letter als hoofdletter: "oktober 2026" → "Oktober 2026". */
export const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
