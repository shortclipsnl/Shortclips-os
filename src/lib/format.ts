/** Nederlandse notatie voor getallen, bedragen en datums — overal hetzelfde. */

const nf = new Intl.NumberFormat("nl-NL");
const cf = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const cfCents = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

export function num(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return nf.format(n);
}

export function euro(value: number | string | null | undefined, cents = false): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return (cents ? cfCents : cf).format(n);
}

/** Grote aantallen compact: 12.400 → 12,4k */
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  if (Math.abs(value) < 1000) return nf.format(value);
  if (Math.abs(value) < 1_000_000)
    return `${nf.format(Math.round(value / 100) / 10)}k`;
  return `${nf.format(Math.round(value / 100_000) / 10)}M`;
}

export function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

const MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

function toDate(input: Date | string | null | undefined): Date | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Datum/tijd altijd in Nederlandse tijd (Europe/Amsterdam), los van de
 *  server-tijdzone. Voorkomt de wintertijd-fout waarbij 16:00 als 15:00 toont. */
const TZ = "Europe/Amsterdam";
const amsFmt = new Intl.DateTimeFormat("nl-NL", {
  timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
function amsParts(d: Date): { day: number; month: number; year: number; hour: string; minute: string } {
  const p: Record<string, string> = {};
  for (const part of amsFmt.formatToParts(d)) p[part.type] = part.value;
  return { day: Number(p.day), month: Number(p.month), year: Number(p.year), hour: (p.hour === "24" ? "00" : p.hour) ?? "00", minute: p.minute ?? "00" };
}

export function formatDate(input: Date | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return "–";
  const p = amsParts(d);
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

export function formatDateFull(input: Date | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return "–";
  const p = amsParts(d);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

export function formatDateTime(input: Date | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return "–";
  const p = amsParts(d);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.hour}:${p.minute}`;
}

/** "3 dagen geleden", "over 2 dagen", "vandaag". */
export function relativeDays(input: Date | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return "–";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - start.getTime()) / 86400000);

  if (diff === 0) return "vandaag";
  if (diff === 1) return "morgen";
  if (diff === -1) return "gisteren";
  if (diff > 0) return `over ${diff} dagen`;
  return `${Math.abs(diff)} dagen geleden`;
}

/** Hoeveel hele dagen geleden. Nooit negatief: "−1 dag geleden" is onzin. */
export function daysSince(input: Date | string | null | undefined): number {
  const d = toDate(input);
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

export function daysUntil(input: Date | string | null | undefined): number {
  const d = toDate(input);
  if (!d) return 0;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  if (!month) return period;
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

export function currentPeriod(offsetMonths = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "1 script" / "3 scripts" — voorkomt "1 script(s)" in de interface. */
export function plural(
  count: number,
  singular: string,
  pluralForm?: string,
): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
